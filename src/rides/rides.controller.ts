import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Request,
} from '@nestjs/common';
import { RidesService } from './rides.service';
import { CreateRideDto } from './dto/create-ride.dto';
import { CancelRideDto } from './dto/cancel-ride.dto';
import { UpdateRideStatusDto } from './dto/update-ride-status.dto';
import { EstimateRideDto, RideOptionDto, EstimateResponseDto } from './dto/estimate-ride.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Role } from '../common/enums/role.enum';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

/**
 * Rides Controller
 * Handles all HTTP requests related to rides
 * Separate endpoints for users and drivers
 */
@ApiTags('Rides')
@Controller('api/v1/rides')
export class RidesController {
  constructor(private readonly ridesService: RidesService) {}

  // ==================== USER ENDPOINTS ====================

  /**
   * Get price estimates for all ride categories
   * POST /api/v1/rides/estimate
   * @body EstimateRideDto - Pickup and dropoff locations
   * @returns Array of ride options with fares
   */
  @Post('estimate')
  @Public()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.USER)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Get ride price estimates' })
  @ApiBody({ type: EstimateRideDto })
  @ApiOkResponse({ description: 'Estimates calculated successfully.', type: EstimateResponseDto })
  async estimateRide(@Body() estimateDto: EstimateRideDto) {
    const estimates = await this.ridesService.estimateRide(estimateDto);
    return {
      message: 'Estimates calculated successfully',
      estimates,
    };
  }

  /**
   * User requests a new ride
   * POST /api/v1/rides
   * @body CreateRideDto - Pickup and dropoff locations
   * @returns The newly created ride with estimated fare
   */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.USER)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Request a new ride' })
  @ApiBody({ type: CreateRideDto })
  @ApiOkResponse({ description: 'Ride requested successfully.' })
  async createRide(@Body() createRideDto: CreateRideDto) {
    const ride = await this.ridesService.createRide(createRideDto);
    return {
      message: 'Ride requested successfully',
      ride,
    };
  }

  /**
   * Get all rides for the authenticated user
   * GET /api/v1/rides/user/:userId
   * @param userId - User UUID
   * @returns Array of user's rides
   */
  @Get('user/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.USER, Role.ADMIN)
  async getUserRides(@Param('userId') userId: string) {
    const rides = await this.ridesService.findByUserId(userId);
    return {
      count: rides.length,
      rides,
    };
  }

  /**
   * User cancels their ride
   * Can only cancel if ride hasn't started (status: requested or accepted)
   * PATCH /api/v1/rides/:id/cancel/user
   * @param id - Ride UUID
   * @param cancelDto - Optional cancellation reason
   * @returns Updated ride
   */
  @Patch(':id/cancel/user')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.USER)
  async cancelRideByUser(
    @Param('id') id: string,
    @Body() cancelDto: CancelRideDto,
    @Request() req: any,
  ) {
    // Get user ID from JWT token payload
    const userId = req.user.id;
    
    const ride = await this.ridesService.cancelRide(id, cancelDto, userId);
    return {
      message: 'Ride cancelled successfully',
      ride,
    };
  }

  // ==================== DRIVER ENDPOINTS ====================

  /**
   * Get all available rides waiting to be accepted
   * GET /api/v1/rides/available
   * @returns Array of rides with status 'requested'
   */
  @Get('available')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DRIVER)
  async getAvailableRides(@Request() req: any) {
    // Get driver ID from JWT token payload
    const driverId = req.user.id;
    
    const rides = await this.ridesService.findAvailableRides(driverId);
    return {
      count: rides.length,
      rides,
    };
  }

  /**
   * Get all rides for a specific driver
   * GET /api/v1/rides/driver/:driverId
   * @param driverId - Driver UUID
   * @returns Array of driver's rides
   */
  @Get('driver/:driverId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DRIVER, Role.ADMIN)
  async getDriverRides(@Param('driverId') driverId: string) {
    const rides = await this.ridesService.findByDriverId(driverId);
    return {
      count: rides.length,
      rides,
    };
  }

  /**
   * Driver accepts a ride request
   * PATCH /api/v1/rides/:id/accept
   * @param id - Ride UUID
   * @param updateDto - Contains vehicle ID
   * @returns Updated ride with driver and vehicle info
   */
  @Patch(':id/accept')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DRIVER)
  async acceptRide(
    @Param('id') id: string,
    @Body() updateDto: UpdateRideStatusDto,
    @Request() req: any,
  ) {
    // Get driver ID from JWT token payload
    const driverId = req.user.id;
    
    const ride = await this.ridesService.acceptRide(id, driverId, updateDto);
    return {
      message: 'Ride accepted successfully',
      ride,
    };
  }

  /**
   * Driver marks that they have arrived at pickup location
   * PATCH /api/v1/rides/:id/arrived
   * @param id - Ride UUID
   * @returns Updated ride
   */
  @Patch(':id/arrived')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DRIVER)
  async markArrived(@Param('id') id: string, @Request() req: any) {
    // Get driver ID from JWT token payload
    const driverId = req.user.id;
    
    const ride = await this.ridesService.markArrived(id, driverId);
    return {
      message: 'Marked as arrived at pickup location',
      ride,
    };
  }

  /**
   * Driver starts the ride (user has entered vehicle)
   * PATCH /api/v1/rides/:id/start
   * @param id - Ride UUID
   * @returns Updated ride
   */
  @Patch(':id/start')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DRIVER)
  async startRide(@Param('id') id: string, @Request() req: any) {
    // Get driver ID from JWT token payload
    const driverId = req.user.id;
    
    const ride = await this.ridesService.startRide(id, driverId);
    return {
      message: 'Ride started successfully',
      ride,
    };
  }

  /**
   * Driver completes the ride (user has reached destination)
   * PATCH /api/v1/rides/:id/complete
   * @param id - Ride UUID
   * @returns Updated ride with final fare
   */
  @Patch(':id/complete')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DRIVER)
  async completeRide(@Param('id') id: string, @Request() req: any) {
    // Get driver ID from JWT token payload
    const driverId = req.user.id;
    
    const ride = await this.ridesService.completeRide(id, driverId);
    return {
      message: 'Ride completed successfully',
      ride,
    };
  }

  /**
   * Driver cancels a ride
   * Can cancel at any time, but must provide reason
   * PATCH /api/v1/rides/:id/cancel/driver
   * @param id - Ride UUID
   * @param cancelDto - Must include cancellation reason
   * @returns Updated ride
   */
  @Patch(':id/cancel/driver')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DRIVER)
  async cancelRideByDriver(
    @Param('id') id: string,
    @Body() cancelDto: CancelRideDto,
    @Request() req: any,
  ) {
    // Get driver ID from JWT token payload
    const driverId = req.user.id;
    
    const ride = await this.ridesService.cancelRide(
      id,
      cancelDto,
      undefined,
      driverId,
    );
    return {
      message: 'Ride cancelled successfully',
      ride,
    };
  }

  // ==================== COMMON ENDPOINTS ====================

  /**
   * Get all rides (Admin only)
   * GET /api/v1/rides
   * @returns Array of all rides
   */
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  async getAllRides() {
    const rides = await this.ridesService.findAll();
    return {
      count: rides.length,
      rides,
    };
  }

  /**
   * Get a single ride by ID
   * GET /api/v1/rides/:id
   * @param id - Ride UUID
   * @returns Ride details with user, driver, and vehicle info
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.USER, Role.DRIVER, Role.ADMIN)
  async getRide(@Param('id') id: string) {
    return await this.ridesService.findOne(id);
  }
}
