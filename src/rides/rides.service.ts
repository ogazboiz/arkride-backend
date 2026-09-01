import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Not } from 'typeorm';
import { Redis } from 'ioredis';
import { Ride, RideStatus, RideCategory } from './entities/ride.entity';
import { User } from '../users/entities/user.entity';
import { Driver } from '../drivers/entities/driver.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { CreateRideDto } from './dto/create-ride.dto';
import { CancelRideDto } from './dto/cancel-ride.dto';
import { UpdateRideStatusDto } from './dto/update-ride-status.dto';
import { EstimateRideDto, RideOptionDto } from './dto/estimate-ride.dto';
import {
  REDIS_CLIENT,
  RIDE_LOCK_PREFIX,
  USER_RIDE_IDEMPOTENCY_PREFIX,
  DRIVER_ACTIVE_RIDE_PREFIX,
} from '../redis/redis.constants';
import {
  RIDE_CATEGORY_VEHICLE_TYPE,
  MAX_ACTIVE_SHARED_RIDES,
  getAllowedCategoriesForVehicleTypes,
  isExclusiveCategory,
  vehicleTypeMatchesCategory,
} from './utils/category-matching.util';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LedgerService } from '../ledger/ledger.service';
import {
  LedgerEntryType,
  StakeholderType,
} from '../ledger/entities/ledger-entry.entity';
import { splitFareKobo, splitFareNaira, toNaira } from '../common/utils/money.util';
import { RIDE_EVENTS } from '../websocket/events/ride-events.constants';

/**
 * RidesService
 * 
 * Purpose: Handle all ride operations with concurrency protection.
 * 
 * Security & Speed Features:
 * 1. Redis Distributed Locking: Prevents multiple drivers from accepting the same ride.
 * 2. Idempotency: Prevents users from accidentally double-booking rides.
 * 3. Atomic Updates: Ensures data consistency under heavy load.
 */
@Injectable()
export class RidesService {
  constructor(
    @InjectRepository(Ride)
    private readonly rideRepository: Repository<Ride>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Driver)
    private readonly driverRepository: Repository<Driver>,
    @InjectRepository(Vehicle)
    private readonly vehicleRepository: Repository<Vehicle>,

    // Inject our high-speed Redis client
    @Inject(REDIS_CLIENT) private readonly redis: Redis,

    // Financial audit trail
    private readonly ledgerService: LedgerService,

    // Domain events. The websocket gateway subscribes to these, which is how
    // realtime works without this service ever knowing a gateway exists.
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Get price estimates for all ride categories
   */
  async estimateRide(estimateDto: EstimateRideDto): Promise<RideOptionDto[]> {
    const { pickup, dropoff } = estimateDto;
    const distance = this.calculateDistance(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);

    return [
      {
        category: RideCategory.PRIVATE,
        displayName: 'Whole Keke',
        estimatedFare: this.calculateFare(distance, RideCategory.PRIVATE),
        distanceKm: distance,
        description: 'Private ride for yourself (1-3 people)',
      },
      {
        category: RideCategory.SHARED,
        displayName: 'Shared Keke',
        estimatedFare: this.calculateFare(distance, RideCategory.SHARED),
        distanceKm: distance,
        description: 'Share with others and pay half price',
      },
      {
        category: RideCategory.OKADA,
        displayName: 'Okada',
        estimatedFare: this.calculateFare(distance, RideCategory.OKADA),
        distanceKm: distance,
        description: 'Fast motorcycle ride for one person',
      },
      {
        category: RideCategory.CAR,
        displayName: 'Car',
        estimatedFare: this.calculateFare(distance, RideCategory.CAR),
        distanceKm: distance,
        description: 'Comfortable car ride for up to 4 people',
      },
    ];
  }

  /**
   * Create a new ride request
   * 
   * Speed Fix: Uses Redis Idempotency to prevent double-booking
   */
  async createRide(createRideDto: CreateRideDto): Promise<Ride> {
    const { userId, pickup, dropoff, category } = createRideDto;

    // STEP 1: Prevention of Double-Booking (Idempotency)
    // We create a unique key for this user's request
    // If they click 'Book' twice within 30 seconds, the second request will be blocked
    const idempotencyKey = `${USER_RIDE_IDEMPOTENCY_PREFIX}${userId}:${pickup.lat}:${pickup.lng}`;
    
    // Attempt to set a 'lock' for 30 seconds
    // 'NX' means "Only set if it doesn't exist"
    // 'EX' means "Expire after 30 seconds"
    const isDuplicate = await this.redis.set(idempotencyKey, 'locked', 'EX', 30, 'NX');

    if (!isDuplicate) {
      throw new BadRequestException(
        'A similar ride request is already being processed. Please wait 30 seconds.',
      );
    }

    try {
      // Verify that the user exists
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');
      if (user.isBlocked) throw new ForbiddenException('Your account has been blocked');

      const distance = this.calculateDistance(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);
      const estimatedFare = this.calculateFare(distance, category);

      const ride = this.rideRepository.create({
        ...createRideDto,
        distanceKm: distance,
        estimatedFare: estimatedFare,
        status: RideStatus.REQUESTED,
        requestedAt: new Date(),
      });

      const savedRide = await this.rideRepository.save(ride);

      // Wakes up every eligible online driver's app instantly
      this.eventEmitter.emit(RIDE_EVENTS.REQUESTED, { ride: savedRide });

      return savedRide;
    } catch (error) {
      // If something fails, remove the idempotency lock so user can try again immediately
      await this.redis.del(idempotencyKey);
      throw error;
    }
  }

  /**
   * Driver accepts a ride request
   * 
   * Reliability Fix: Uses Redis Distributed Locking
   * This handles the case where 2+ drivers click "Accept" at the same millisecond.
   */
  async acceptRide(
    rideId: string,
    driverId: string,
    updateDto: UpdateRideStatusDto,
  ): Promise<Ride> {
    // STEP 1: Grab the "Talking Stick" (Redis Lock)
    const lockKey = `${RIDE_LOCK_PREFIX}${rideId}`;
    const lockAcquired = await this.redis.set(lockKey, driverId, 'EX', 10, 'NX');

    if (!lockAcquired) {
      throw new BadRequestException(
        'This ride is currently being processed by another driver. Please try another one.',
      );
    }

    try {
      // STEP 2: Standard Validations
      const ride = await this.findOne(rideId);
      if (ride.status !== RideStatus.REQUESTED) {
        throw new BadRequestException('This ride has already been taken.');
      }

      const driver = await this.driverRepository.findOne({ where: { id: driverId } });
      if (!driver || !driver.isActive || !driver.isOnline) {
        throw new ForbiddenException('Driver account is invalid or offline');
      }

      const vehicle = await this.vehicleRepository.findOne({ where: { id: updateDto.vehicleId } });
      if (!vehicle || vehicle.driverId !== driverId || !vehicle.isActive) {
        throw new BadRequestException('Vehicle is invalid or does not belong to you');
      }

      // STEP 3: Category and Concurrency Validations

      // 3a. Vehicle Type Matching
      // Rules live in category-matching.util.ts so adding a fleet class is a one-file change
      if (!vehicleTypeMatchesCategory(vehicle.type, ride.category)) {
        const required = RIDE_CATEGORY_VEHICLE_TYPE[ride.category];
        throw new BadRequestException(
          `${ride.category} rides require a ${required} vehicle type`,
        );
      }

      // 3b. Active Ride Limits
      const activeRides = await this.rideRepository.find({
        where: {
          driverId: driverId,
          status: In([RideStatus.ACCEPTED, RideStatus.ARRIVED, RideStatus.IN_PROGRESS]),
        },
      });

      // If already on an exclusive ride (Private, Okada or Car), can't take anything else
      const hasExclusiveRide = activeRides.some(r => isExclusiveCategory(r.category));
      if (hasExclusiveRide) {
        throw new BadRequestException('You are currently on an exclusive ride and cannot accept more.');
      }

      // If the new ride is exclusive, the driver must have 0 active rides
      if (isExclusiveCategory(ride.category) && activeRides.length > 0) {
        throw new BadRequestException(
          'Private, Okada and Car rides require you to have no other active rides.',
        );
      }

      // If new ride is Shared, must not exceed the shared pooling limit
      if (ride.category === RideCategory.SHARED) {
        if (activeRides.length >= MAX_ACTIVE_SHARED_RIDES) {
          throw new BadRequestException(
            `You have reached the maximum of ${MAX_ACTIVE_SHARED_RIDES} active shared rides.`,
          );
        }
      }

      // STEP 4: Atomic Database Update
      ride.driverId = driverId;
      ride.vehicleId = updateDto?.vehicleId as string;
      ride.status = RideStatus.ACCEPTED;
      ride.acceptedAt = new Date();

      const savedRide = await this.rideRepository.save(ride);

      // Remember which ride this driver is serving, so their GPS pings can be
      // routed to the right ride room without a database lookup per ping.
      await this.redis.set(
        `${DRIVER_ACTIVE_RIDE_PREFIX}${driverId}`,
        rideId,
        'EX',
        60 * 60 * 6, // safety expiry: no ride should outlive 6 hours
      );

      // LOG: Success!
      console.log(`✅ Ride ${rideId} (${ride.category}) successfully assigned to Driver ${driverId}`);

      // Tells the rider they have a driver, and other drivers to drop it
      this.eventEmitter.emit(RIDE_EVENTS.ACCEPTED, { ride: savedRide });

      return savedRide;
    } finally {
      // STEP 5: Always release the lock so the system stays clean
      await this.redis.del(lockKey);
    }
  }

  // --- REST OF THE METHODS (Unchanged but documented) ---

  async findAll(): Promise<Ride[]> {
    return await this.rideRepository.find({
      relations: ['user', 'driver', 'vehicle'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Ride> {
    const ride = await this.rideRepository.findOne({
      where: { id },
      relations: ['user', 'driver', 'driver.location', 'vehicle'],
    });
    if (!ride) throw new NotFoundException('Ride not found');
    return ride;
  }

  async findByUserId(userId: string): Promise<Ride[]> {
    return await this.rideRepository.find({
      where: { userId },
      relations: ['driver', 'vehicle'],
      order: { createdAt: 'DESC' },
    });
  }

  async findByDriverId(driverId: string): Promise<Ride[]> {
    return await this.rideRepository.find({
      where: { driverId },
      relations: ['user', 'vehicle'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Filter available rides based on driver's vehicle types
   */
  async findAvailableRides(driverId: string): Promise<Ride[]> {
    const vehicles = await this.vehicleRepository.find({
      where: { driverId, isActive: true },
    });

    if (vehicles.length === 0) return [];

    const allowedCategories = getAllowedCategoriesForVehicleTypes(
      vehicles.map((v) => v.type),
    );

    if (allowedCategories.length === 0) return [];

    return await this.rideRepository.find({
      where: { 
        status: RideStatus.REQUESTED,
        category: In(allowedCategories),
      },
      relations: ['user'],
      order: { requestedAt: 'ASC' },
    });
  }

  async markArrived(rideId: string, driverId: string): Promise<Ride> {
    const ride = await this.findOne(rideId);
    if (ride.driverId !== driverId) throw new ForbiddenException('Access denied');
    if (ride.status !== RideStatus.ACCEPTED) throw new BadRequestException('Invalid state');
    ride.status = RideStatus.ARRIVED;

    const savedRide = await this.rideRepository.save(ride);
    this.eventEmitter.emit(RIDE_EVENTS.ARRIVED, { ride: savedRide });

    return savedRide;
  }

  async startRide(rideId: string, driverId: string): Promise<Ride> {
    const ride = await this.findOne(rideId);
    if (ride.driverId !== driverId) throw new ForbiddenException('Access denied');
    if (ride.status !== RideStatus.ARRIVED) throw new BadRequestException('Invalid state');
    ride.status = RideStatus.IN_PROGRESS;
    ride.startedAt = new Date();

    const savedRide = await this.rideRepository.save(ride);
    this.eventEmitter.emit(RIDE_EVENTS.STARTED, { ride: savedRide });

    return savedRide;
  }

  /**
   * Driver completes the ride, triggering the 95 / 4 / 1 revenue split.
   *
   * This method moves money, so it is defended in three independent layers:
   *
   * 1. Redis lock  — stops a duplicate HTTP request racing itself before the
   *                  transaction is even open.
   * 2. Row lock    — pessimistic_write on the ride and both balance rows, so
   *                  true database-level concurrency serialises.
   * 3. Unique index on ledger (rideId, type) — the last-resort backstop that
   *                  makes a double payout impossible even if 1 and 2 failed.
   *
   * Everything commits together or not at all, and the realtime notification
   * is emitted only AFTER the commit — a rolled back completion must never
   * tell clients the ride finished.
   */
  async completeRide(rideId: string, driverId: string): Promise<Ride> {
    const lockKey = `${RIDE_LOCK_PREFIX}${rideId}`;
    const lockAcquired = await this.redis.set(lockKey, driverId, 'EX', 10, 'NX');

    if (!lockAcquired) {
      throw new BadRequestException(
        'This ride is already being completed. Please wait a moment.',
      );
    }

    try {
      const { ride, split, alreadyCompleted } =
        await this.rideRepository.manager.transaction(async (manager) => {
          const ride = await manager.findOne(Ride, {
            where: { id: rideId },
            lock: { mode: 'pessimistic_write' },
          });

          if (!ride) throw new NotFoundException('Ride not found');
          if (ride.driverId !== driverId) throw new ForbiddenException('Access denied');

          // Idempotent: a retry of an already-settled ride is a no-op, not an error
          if (ride.status === RideStatus.COMPLETED) {
            return { ride, split: splitFareNaira(ride.finalFare ?? 0), alreadyCompleted: true };
          }

          if (ride.status !== RideStatus.IN_PROGRESS) {
            throw new BadRequestException('Invalid state');
          }

          const finalFare = Number(ride.estimatedFare ?? 0);
          const { driverKobo, platformKobo, riderKobo } = splitFareKobo(finalFare);

          ride.finalFare = finalFare;
          ride.status = RideStatus.COMPLETED;
          ride.completedAt = new Date();
          await manager.save(ride);

          // Driver takes 95%
          const driver = await manager.findOne(Driver, {
            where: { id: driverId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!driver) throw new NotFoundException('Driver not found');

          driver.walletBalance =
            Number(driver.walletBalance || 0) + toNaira(driverKobo);
          driver.totalCompletedRides = (driver.totalCompletedRides || 0) + 1;
          await manager.save(driver);

          // Rider takes 1% back as cashback
          const user = await manager.findOne(User, {
            where: { id: ride.userId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!user) throw new NotFoundException('User not found');

          user.cashbackBalance =
            Number(user.cashbackBalance || 0) + toNaira(riderKobo);
          await manager.save(user);

          // Platform takes 4% — recorded in the ledger only, no balance column
          await this.ledgerService.writeEntries(
            [
              {
                rideId,
                type: LedgerEntryType.RIDE_FARE_DRIVER,
                stakeholderType: StakeholderType.DRIVER,
                stakeholderId: driverId,
                amount: toNaira(driverKobo),
                metadata: { finalFare },
              },
              {
                rideId,
                type: LedgerEntryType.RIDE_FARE_PLATFORM,
                stakeholderType: StakeholderType.PLATFORM,
                stakeholderId: null,
                amount: toNaira(platformKobo),
                metadata: { finalFare },
              },
              {
                rideId,
                type: LedgerEntryType.RIDE_FARE_RIDER_CASHBACK,
                stakeholderType: StakeholderType.RIDER,
                stakeholderId: ride.userId,
                amount: toNaira(riderKobo),
                metadata: { finalFare },
              },
            ],
            manager,
          );

          return {
            ride,
            split: splitFareNaira(finalFare),
            alreadyCompleted: false,
          };
        });

      if (!alreadyCompleted) {
        // The driver is free again — clear the active-ride pointer used to
        // route their GPS pings to a ride room.
        await this.redis.del(`${DRIVER_ACTIVE_RIDE_PREFIX}${driverId}`);

        console.log(
          `💰 Ride ${rideId} settled — driver ₦${split.driverEarning}, platform ₦${split.platformCommission}, rider cashback ₦${split.riderCashback}`,
        );

        // Emitted post-commit only
        this.eventEmitter.emit(RIDE_EVENTS.COMPLETED, { ride, split });
      }

      return ride;
    } finally {
      await this.redis.del(lockKey);
    }
  }

  async cancelRide(rideId: string, cancelDto: CancelRideDto, userId?: string, driverId?: string): Promise<Ride> {
    const ride = await this.findOne(rideId);
    if (ride.status === RideStatus.COMPLETED) throw new BadRequestException('Completed');
    if (userId && (ride.userId !== userId || ride.status === RideStatus.IN_PROGRESS)) throw new ForbiddenException('Denied');
    if (driverId && (ride.driverId !== driverId || !cancelDto.cancellationReason)) throw new ForbiddenException('Denied');
    ride.status = RideStatus.CANCELLED;
    ride.cancellationReason = cancelDto.cancellationReason || 'Cancelled by user';

    const savedRide = await this.rideRepository.save(ride);

    // Free the driver's active-ride pointer if one was assigned
    if (savedRide.driverId) {
      await this.redis.del(`${DRIVER_ACTIVE_RIDE_PREFIX}${savedRide.driverId}`);
    }

    this.eventEmitter.emit(RIDE_EVENTS.CANCELLED, { ride: savedRide });

    return savedRide;
  }

  /**
   * The transparent revenue breakdown for one ride.
   *
   * Readable by either party to the ride (and admins). For a completed ride the
   * numbers come from the ledger — the actual money that moved — rather than
   * being recomputed, so what the user sees is what was really paid out. For a
   * ride still in flight it projects the split off the current estimate.
   */
  async getFareBreakdown(rideId: string, requesterId: string, isAdmin = false) {
    const ride = await this.findOne(rideId);

    const isParty = ride.userId === requesterId || ride.driverId === requesterId;
    if (!isAdmin && !isParty) {
      throw new ForbiddenException('You are not a party to this ride');
    }

    if (ride.status === RideStatus.COMPLETED) {
      const entries = await this.ledgerService.findByRideId(rideId);
      const amountFor = (type: LedgerEntryType) =>
        Number(entries.find((entry) => entry.type === type)?.amount ?? 0);

      return {
        rideId,
        status: ride.status,
        settled: true,
        totalFare: Number(ride.finalFare ?? 0),
        driverEarning: amountFor(LedgerEntryType.RIDE_FARE_DRIVER),
        platformCommission: amountFor(LedgerEntryType.RIDE_FARE_PLATFORM),
        riderCashback: amountFor(LedgerEntryType.RIDE_FARE_RIDER_CASHBACK),
        shares: { driver: '95%', platform: '4%', rider: '1%' },
      };
    }

    return {
      rideId,
      status: ride.status,
      settled: false,
      ...splitFareNaira(ride.estimatedFare ?? 0),
      shares: { driver: '95%', platform: '4%', rider: '1%' },
    };
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = this.degreesToRadians(lat2 - lat1);
    const dLon = this.degreesToRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(this.degreesToRadians(lat1)) * Math.cos(this.degreesToRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 100) / 100;
  }

  /**
   * Calculate fare based on category
   * 
   * Pricing Rules:
   * - PRIVATE: 500 base + 100/km
   * - SHARED: 250 base + 50/km (50% of Private)
   * - OKADA: 300 base + 70/km
   * - CAR: 1000 base + 200/km
   */
  private calculateFare(distance: number, category: RideCategory): number {
    let base = 500;
    let perKm = 100;

    switch (category) {
      case RideCategory.SHARED:
        base = 250;
        perKm = 50;
        break;
      case RideCategory.OKADA:
        base = 300;
        perKm = 70;
        break;
      case RideCategory.CAR:
        base = 1000;
        perKm = 200;
        break;
      case RideCategory.PRIVATE:
      default:
        base = 500;
        perKm = 100;
        break;
    }

    return Math.round((base + distance * perKm) * 100) / 100;
  }

  private degreesToRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }
}
