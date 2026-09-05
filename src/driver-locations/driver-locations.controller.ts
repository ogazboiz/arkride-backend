import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseFloatPipe,
  NotFoundException,
  ParseUUIDPipe,
  ForbiddenException,
} from '@nestjs/common';
import { enveloped } from '../common/dto/api-response';
import { DriverLocationsService } from './driver-locations.service';
import { UpdateLocationDto } from './dto/update-location.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { firstNameOf } from './driver-locations.service';
import type { Principal } from '../common/utils/ownership.util';
import { Role } from '../common/enums/role.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';

/**
 * DriverLocationsController
 * 
 * Purpose: HTTP endpoints for driver location management
 * 
 * Routes:
 * - POST /api/v1/driver-locations → Driver updates their GPS location
 * - GET /api/v1/driver-locations/driver/:driverId → Get specific driver's location
 * - GET /api/v1/driver-locations/nearby → Find nearby drivers
 */
@ApiTags('Driver Locations')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/driver-locations')
export class DriverLocationsController {
  constructor(
    private readonly driverLocationsService: DriverLocationsService,
  ) { }

  /**
   * Update driver's current GPS location
   * 
   * POST /api/v1/driver-locations
   * 
   * Who calls this: Driver's mobile app (every 30-60 seconds while online)
   * 
   * How it works:
   * 1. Driver's app gets GPS coordinates from phone
   * 2. App sends POST request with lat/lng
   * 3. Backend updates driver's location in database
   * 4. Location is now available for ride matching
   * 
   * Security: Driver ID is automatically extracted from JWT token
   * 
   * Example Request:
   * POST /api/v1/driver-locations
   * Headers: { Authorization: "Bearer <driver_jwt_token>" }
   * Body: {
   *   "latitude": 6.5244,
   *   "longitude": 3.3792
   * }
   * 
   * Example Response:
   * {
   *   "message": "Location updated successfully",
   *   "location": {
   *     "id": "location-uuid",
   *     "latitude": 6.5244,
   *     "longitude": 3.3792,
   *     "updatedAt": "2025-12-26T10:30:00Z"
   *   }
   * }
   */
  // Drivers only. This was `JwtAuthGuard` alone, so a RIDER's token could
  // publish a GPS ping — and since the driver id is taken from the token, it
  // wrote a location row keyed by a user id that no driver lookup will ever
  // match, quietly polluting the geo set.
  @Post()
  @Roles(Role.DRIVER)
  @HttpCode(HttpStatus.OK)
  async updateLocation(
    @Body() updateLocationDto: UpdateLocationDto,
    @CurrentUser() user: any,
  ) {
    // Security: Only allow drivers to update their own location
    const location = await this.driverLocationsService.updateLocation(
      user.id,
      updateLocationDto,
    );

    return enveloped(
      {
        id: location.driverId,
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
        updatedAt: location.updatedAt,
      },
      'Location updated successfully',
    );
  }

  /**
   * Get a specific driver's current location
   * 
   * GET /api/v1/driver-locations/driver/:driverId
   * 
   * Who calls this:
   * - Users wanting to see driver's location on map
   * - Admin dashboard showing driver positions
   * 
   * Example Request:
   * GET /api/v1/driver-locations/driver/abc-123-def
   * Headers: { Authorization: "Bearer <jwt_token>" }
   * 
   * Example Response:
   * {
   *   "id": "location-uuid",
   *   "driver": {
   *     "id": "abc-123-def",
   *     "name": "John Driver",
   *     "phone": "08012345678"
   *   },
   *   "latitude": 6.5244,
   *   "longitude": 3.3792,
   *   "updatedAt": "2025-12-26T10:30:00Z"
   * }
   */
  @Get('driver/:driverId')
  @Roles(Role.USER, Role.DRIVER, Role.ADMIN)
  @ApiOperation({ summary: 'Get location for a specific driver' })
  @ApiParam({ name: 'driverId', description: 'Driver UUID' })
  @ApiOkResponse({ description: 'Driver location fetched successfully.' })
  async getDriverLocation(
    @Param('driverId', new ParseUUIDPipe({ version: '4' })) driverId: string,
    @CurrentUser() principal: Principal,
  ) {
    // SECURITY: this route had no ownership check at all, and it returned the
    // driver's FULL NAME, PHONE NUMBER and exact coordinates to any
    // authenticated account.
    //
    // That also silently undid the hardening on /nearby two handlers down.
    // /nearby stopped returning names and phone numbers — but it still returns
    // driver IDS, so the fleet scrape simply became two requests instead of
    // one: sweep /nearby for ids, then call this for each. Redacting one
    // endpoint while the other stayed open was cosmetic.
    //
    // Live position is now visible to: the driver themselves, an admin, or a
    // rider who has an ACTIVE ride assigned to that driver — which is the only
    // legitimate reason a rider has to watch someone's car move.
    const allowed = await this.driverLocationsService.canViewDriverLocation(
      principal,
      driverId,
    );
    if (!allowed) {
      throw new ForbiddenException(
        'You can only view the location of a driver on your active ride.',
      );
    }

    const location = await this.driverLocationsService.findByDriverId(driverId);

    if (!location.driver) {
      throw new NotFoundException(`Driver ${driverId} not found`);
    }

    return {
      id: location.driver.id,
      driver: {
        id: location.driver.id,
        // First name only, and no phone. A rider who needs to call their
        // driver gets the number from the RIDE, which exists only once the
        // two are actually matched.
        name: firstNameOf(location.driver.name),
      },
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
    };
  }

  /**
   * Find drivers near a specific location
   * 
   * GET /api/v1/driver-locations/nearby?lat=6.5964&lng=3.3486&radius=50
   * 
   * Who calls this:
   * - Backend when user requests a ride (to find available drivers)
   * - User app to show nearby drivers on map
   * 
   * Query Parameters:
   * - lat (required): Latitude of pickup/search location
   * - lng (required): Longitude of pickup/search location
   * - radius (optional): Search radius in kilometers (default: 50km)
   * 
   * How it works:
   * 1. Takes user's pickup location (lat/lng)
   * 2. Finds all online drivers
   * 3. Calculates distance to each driver using Haversine formula
   * 4. Filters drivers within radius
   * 5. Returns sorted by distance (closest first)
   * 
   * Example Request:
   * GET /api/v1/driver-locations/nearby?lat=6.5964&lng=3.3486&radius=50
   * Headers: { Authorization: "Bearer <jwt_token>" }
   * 
   * Example Response:
   * {
   *   "searchLocation": {
   *     "lat": 6.5964,
   *     "lng": 3.3486
   *   },
   *   "radius": 50,
   *   "count": 3,
   *   "drivers": [
   *     {
   *       "driver": {
   *         "id": "driver-1-uuid",
   *         "name": "John Driver",
   *         "phone": "08012345678",
   *         "ratingAverage": 4.8,
   *         "totalCompletedRides": 150,
   *         "vehicles": [{ type: "keke", plateNumber: "ABC-123" }]
   *       },
   *       "distance": 2.5,
   *       "location": {
   *         "lat": 6.5800,
   *         "lng": 3.3500
   *       },
   *       "lastUpdated": "2025-12-26T10:30:00Z"
   *     },
   *     {
   *       "driver": {
   *         "id": "driver-2-uuid",
   *         "name": "Jane Driver",
   *         "phone": "08087654321",
   *         "ratingAverage": 4.9,
   *         "totalCompletedRides": 200,
   *         "vehicles": [{ type: "bike", plateNumber: "XYZ-789" }]
   *       },
   *       "distance": 8.3,
   *       "location": {
   *         "lat": 6.5500,
   *         "lng": 3.4000
   *       },
   *       "lastUpdated": "2025-12-26T10:29:45Z"
   *     }
   *   ]
   * }
   * 
   * Note: Default radius is 50km for rural areas
   * Urban areas can use smaller radius (e.g., 5-10km)
   */
  @Get('nearby')
  @Roles(Role.USER, Role.DRIVER, Role.ADMIN)
  @ApiOperation({ summary: 'Find nearby drivers by coordinates and radius' })
  @ApiQuery({ name: 'lat', type: Number, required: true, description: 'Latitude of search point' })
  @ApiQuery({ name: 'lng', type: Number, required: true, description: 'Longitude of search point' })
  @ApiQuery({ name: 'radius', type: Number, required: false, description: 'Search radius in kilometers (default: 50)' })
  @ApiOkResponse({ description: 'Nearby drivers fetched successfully.' })
  async findNearbyDrivers(
    @Query('lat', ParseFloatPipe) lat: number,
    @Query('lng', ParseFloatPipe) lng: number,
    @Query('radius') radius?: string,
  ) {
    // `radius` was `Number(radius)` with no bound and no validation, so
    // `?radius=20000` swept the planet and returned the whole fleet in one
    // call, and `?radius=abc` produced NaN which GEORADIUS rejects with a
    // driver-level error.
    const searchRadius = clampRadiusKm(radius);

    const drivers = await this.driverLocationsService.findNearbyDrivers(
      lat,
      lng,
      searchRadius,
    );

    return {
      searchLocation: {
        lat,
        lng,
      },
      radius: searchRadius,
      count: drivers.length,
      drivers,
    };
  }
}

/** Widest sweep a client may ask for. Dispatch uses the service directly. */
export const MAX_NEARBY_RADIUS_KM = 50;
export const DEFAULT_NEARBY_RADIUS_KM = 10;

/**
 * Turn an untrusted `radius` query value into a usable number of kilometres.
 *
 * Exported for the unit test: NaN, negatives, zero and absurd values are the
 * whole point, and each has a different right answer.
 */
export function clampRadiusKm(raw: string | number | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_NEARBY_RADIUS_KM;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_NEARBY_RADIUS_KM;
  return Math.min(parsed, MAX_NEARBY_RADIUS_KM);
}
