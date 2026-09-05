import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Redis } from 'ioredis';
import { Driver } from '../drivers/entities/driver.entity';
import { UpdateLocationDto } from './dto/update-location.dto';
import {
  REDIS_CLIENT,
  DRIVER_LOCATION_GEO_KEY,
  DRIVER_ACTIVE_PREFIX,
  DRIVER_ACTIVE_RIDE_PREFIX,
} from '../redis/redis.constants';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RIDE_EVENTS } from '../websocket/events/ride-events.constants';

/**
 * DriverLocationsService
 * 
 * Purpose: Manage driver GPS locations using high-speed Redis Geospatial.
 * 
 * Scalability Fix:
 * 1. Redis GEOADD: Stores coordinates in RAM for instant updates.
 * 2. Redis GEORADIUS: Proximity search in sub-milliseconds.
 * 3. TTL (Freshness): Inactive drivers automatically expire.
 */
@Injectable()
export class DriverLocationsService {
  constructor(
    @InjectRepository(Driver)
    private readonly driverRepository: Repository<Driver>,

    // Inject our high-speed Redis client
    @Inject(REDIS_CLIENT) private readonly redis: Redis,

    // Realtime location push to the rider watching the map
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Update a driver's GPS location in Redis
   * 
   * Speed: Redis handles this in ~0.5ms.
   * 
   * Security: driverId is passed from authenticated user, not from request body
   */
  async updateLocation(driverId: string, updateLocationDto: UpdateLocationDto) {
    const { latitude, longitude } = updateLocationDto;

    // STEP 1: Verify driver exists and is allowed to be online
    // (We keep this in DB for security validation)
    const driver = await this.driverRepository.findOne({
      where: { id: driverId },
    });

    if (!driver) {
      throw new NotFoundException(`Driver ${driverId} not found`);
    }

    if (!driver.isOnline) {
      throw new BadRequestException('Driver must be online to update location');
    }

    // STEP 2: Update Redis Geospatial set
    // GEOADD key longitude latitude member
    await this.redis.geoadd(
      DRIVER_LOCATION_GEO_KEY,
      longitude,
      latitude,
      driverId
    );

    // STEP 3: Set an 'Active' key with TTL (5 minutes)
    // If we don't hear from the driver for 5 mins, we'll know they are "stale"
    const activeKey = `${DRIVER_ACTIVE_PREFIX}${driverId}`;
    await this.redis.set(activeKey, 'active', 'EX', 300);

    const updatedAt = new Date();

    // STEP 4: If this driver is mid-ride, push the position straight to the
    // rider watching the map. The active-ride pointer is kept in Redis by
    // RidesService so a GPS ping never costs a database round trip.
    const rideId = await this.redis.get(`${DRIVER_ACTIVE_RIDE_PREFIX}${driverId}`);

    if (rideId) {
      this.eventEmitter.emit(RIDE_EVENTS.DRIVER_LOCATION_UPDATED, {
        driverId,
        rideId,
        latitude,
        longitude,
        updatedAt,
      });
    }

    return {
      driverId,
      latitude,
      longitude,
      updatedAt,
    };
  }

  /**
   * Find all online drivers near a specific location
   * 
   * Scalability: Redis searches thousands of drivers instantly.
   */
  /**
   * Online drivers within `radiusKm` of a point.
   *
   * The radius is clamped by the CALLER (see MAX_NEARBY_RADIUS_KM in the
   * controller) rather than here, so this stays usable for internal dispatch
   * where a wide sweep is legitimate.
   */
  async findNearbyDrivers(
    userLat: number,
    userLng: number,
    radiusKm: number = 50,
  ) {
    // STEP 1: Search Redis Smart Map
    // GEORADIUS key lng lat radius km WITHDIST WITHCOORD
    const results = await this.redis.georadius(
      DRIVER_LOCATION_GEO_KEY,
      userLng,
      userLat,
      radiusKm,
      'km',
      'WITHDIST',
      'WITHCOORD'
    ) as any[];

    if (!results || results.length === 0) return [];

    // results format: [ [driverId, distance, [lng, lat]], ... ]
    const nearbyDriverIds = results.map(r => r[0]);

    // STEP 2: Fetch minimal details from DB for the results
    // We only fetch info for the drivers found by Redis
    const drivers = await this.driverRepository.find({
      where: { 
        id: In(nearbyDriverIds),
        isOnline: true,
        isActive: true
      },
      relations: ['vehicles']
    });

    // STEP 3: Combine Redis distance data with DB driver data
    const finalResults = results.map(r => {
      const driverId = r[0];
      const distance = parseFloat(r[1]);
      const coords = r[2];
      
      const dbDriver = drivers.find(d => d.id === driverId);
      if (!dbDriver) return null; // Driver might have gone offline/inactive since search

      return {
        driver: {
          id: dbDriver.id,
          // First name only. This is a DISCOVERY response — it answers "is
          // anyone near me", which every authenticated rider may ask about
          // any point on the map. It used to return the driver's full name
          // and PHONE NUMBER, so `?lat=..&lng=..&radius=20000` returned a
          // contact list for the entire fleet.
          //
          // The rider gets the driver's real contact details once the driver
          // accepts their ride, from the ride record — at which point there
          // is an actual relationship between the two.
          name: firstNameOf(dbDriver.name),
          ratingAverage: dbDriver.ratingAverage,
          totalCompletedRides: dbDriver.totalCompletedRides,
          vehicles: (dbDriver.vehicles ?? []).map((vehicle) => ({
            id: vehicle.id,
            type: vehicle.type,
            model: vehicle.model,
            color: vehicle.color,
          })),
        },
        distance: Number(distance.toFixed(2)),
        location: {
          lat: Number(coords[1]),
          lng: Number(coords[0]),
        }
      };
    }).filter(res => res !== null);

    // Sort by distance
    return finalResults.sort((a, b) => a.distance - b.distance);
  }

  /**
   * Remove a driver from the active map
   */
  async removeLocation(driverId: string) {
    await this.redis.zrem(DRIVER_LOCATION_GEO_KEY, driverId);
    await this.redis.del(`${DRIVER_ACTIVE_PREFIX}${driverId}`);
  }

  /**
   * Get a specific driver's location from Redis
   */
  async findByDriverId(driverId: string) {
    const pos = await this.redis.geopos(DRIVER_LOCATION_GEO_KEY, driverId);
    
    if (!pos || !pos[0]) {
      throw new NotFoundException(`Location not found for driver ${driverId}`);
    }

    const driver = await this.driverRepository.findOne({ where: { id: driverId } });

    return {
      driver,
      latitude: parseFloat(pos[0][1]),
      longitude: parseFloat(pos[0][0]),
    };
  }
}

/**
 * The part of a name safe to show before a ride exists.
 *
 * Falls back to the whole string when there is no space, and to 'Driver' when
 * the name is empty — never to undefined, which would render as a blank card.
 */
export function firstNameOf(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return 'Driver';
  return trimmed.split(/\s+/)[0];
}
