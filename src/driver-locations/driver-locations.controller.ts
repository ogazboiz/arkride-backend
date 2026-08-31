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
} from '@nestjs/common';
import { DriverLocationsService } from './driver-locations.service';
import { UpdateLocationDto } from './dto/update-location.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
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
  @Post()
  @UseGuards(JwtAuthGuard)
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

    return {
      message: 'Location updated successfully',
      location: {
        id: location.driverId,
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
        updatedAt: location.updatedAt,
      },
    };
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
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Get location for a specific driver' })
  @ApiParam({ name: 'driverId', description: 'Driver UUID' })
  @ApiOkResponse({ description: 'Driver location fetched successfully.' })
  async getDriverLocation(@Param('driverId') driverId: string) {
    const location = await this.driverLocationsService.findByDriverId(driverId);

    if (!location.driver) {
      throw new NotFoundException([`Driver ${driverId} not found`]);
    }

    return {
      id: location.driver?.id ?? driverId,
      driver: {
        id: location?.driver.id,
        name: location?.driver.name,
        phone: location?.driver.phone,
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
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Find nearby drivers by coordinates and radius' })
  @ApiQuery({ name: 'lat', type: Number, required: true, description: 'Latitude of search point' })
  @ApiQuery({ name: 'lng', type: Number, required: true, description: 'Longitude of search point' })
  @ApiQuery({ name: 'radius', type: Number, required: false, description: 'Search radius in kilometers (default: 50)' })
  @ApiOkResponse({ description: 'Nearby drivers fetched successfully.' })
  async findNearbyDrivers(
    @Query('lat', ParseFloatPipe) lat: number,
    @Query('lng', ParseFloatPipe) lng: number,
    @Query('radius') radius?: number,
  ) {
    // Parse radius or use default 50km
    const searchRadius = radius ? Number(radius) : 50;

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
