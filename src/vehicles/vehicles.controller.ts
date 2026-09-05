import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { assertOwnership, isAdmin } from '../common/utils/ownership.util';
import type { Principal } from '../common/utils/ownership.util';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { enveloped, listMeta } from '../common/dto/api-response';

/**
 * Vehicles.
 *
 * SECURITY: every route in this controller used to carry `JwtAuthGuard` and
 * nothing else — no RolesGuard, no @Roles, and no ownership check in the
 * service. Any authenticated RIDER could therefore:
 *
 *   POST   /vehicles           with any driverId -> attach a vehicle to anyone
 *   PATCH  /vehicles/:id       -> rewrite a stranger's plate number
 *   PATCH  /vehicles/:id/deactivate -> take a competitor off the road
 *   DELETE /vehicles/:id       -> delete a stranger's vehicle
 *   GET    /vehicles           -> enumerate the entire fleet
 *
 * Guards are declared once at class level; each handler adds the roles it
 * accepts and asserts ownership against the row it is about to touch.
 */
@ApiTags('Vehicles')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Post()
  @Roles(Role.DRIVER, Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Create vehicle for a driver' })
  @ApiBody({ type: CreateVehicleDto })
  @ApiCreatedResponse({ description: 'Vehicle created successfully.' })
  async create(
    @Body() createVehicleDto: CreateVehicleDto,
    @CurrentUser() principal: Principal,
  ) {
    // A driver registers a vehicle for themselves, full stop. Their id comes
    // from the verified token, never from the body — that substitution is the
    // whole fix. Rejecting a driver-supplied driverId (rather than quietly
    // overwriting it) means a client that believes it is choosing the owner
    // gets told it is not.
    // Refuse FIRST, then decide the owner. Computing it before the check read
    // backwards even though nothing observable happened in between.
    if (!isAdmin(principal) && createVehicleDto.driverId !== undefined) {
      throw new ForbiddenException(
        'You cannot register a vehicle for another driver.',
      );
    }

    // An admin must NAME the driver. Falling back to `principal.id` handed the
    // service an id from the USERS table, which then failed with a misleading
    // "Driver not found".
    if (isAdmin(principal) && !createVehicleDto.driverId) {
      throw new BadRequestException(
        'An admin must specify which driver this vehicle belongs to.',
      );
    }

    const ownerId = isAdmin(principal)
      ? (createVehicleDto.driverId as string)
      : principal.id;

    const vehicle = await this.vehiclesService.create({
      ...createVehicleDto,
      driverId: ownerId,
    });
    return enveloped(vehicle, 'Vehicle created successfully');
  }

  /** The whole fleet. Admin only — this was readable by any rider. */
  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'List all vehicles (admin)' })
  @ApiOkResponse({ description: 'Vehicles fetched successfully.' })
  async findAll() {
    const vehicles = await this.vehiclesService.findAll();
    return enveloped(vehicles, undefined, listMeta(vehicles));
  }

  // Move specific routes BEFORE :id route
  @Get('driver/:driverId')
  @Roles(Role.DRIVER, Role.ADMIN)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'List vehicles for a driver' })
  @ApiParam({ name: 'driverId', description: 'Driver UUID' })
  @ApiOkResponse({ description: 'Driver vehicles fetched successfully.' })
  async findByDriverId(
    @Param('driverId') driverId: string,
    @CurrentUser() principal: Principal,
  ) {
    assertOwnership(principal, driverId, 'view your own vehicles');
    const vehicles = await this.vehiclesService.findByDriverId(driverId);
    return enveloped(vehicles, undefined, listMeta(vehicles));
  }

  @Get(':id')
  @Roles(Role.DRIVER, Role.ADMIN)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Get vehicle by ID' })
  @ApiParam({ name: 'id', description: 'Vehicle UUID' })
  @ApiOkResponse({ description: 'Vehicle fetched successfully.' })
  async findOne(@Param('id') id: string, @CurrentUser() principal: Principal) {
    const vehicle = await this.vehiclesService.findOne(id);
    assertOwnership(principal, vehicle.driverId, 'view your own vehicles');
    return vehicle;
  }

  // Move activate/deactivate routes BEFORE :id PATCH route
  @Patch(':id/deactivate')
  @Roles(Role.DRIVER, Role.ADMIN)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Deactivate a vehicle' })
  @ApiParam({ name: 'id', description: 'Vehicle UUID' })
  @ApiOkResponse({ description: 'Vehicle deactivated successfully.' })
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() principal: Principal,
  ) {
    await this.assertOwnsVehicle(principal, id, 'deactivate your own vehicles');
    const vehicle = await this.vehiclesService.deactivate(id);
    return enveloped(vehicle, 'Vehicle deactivated successfully');
  }

  @Patch(':id/activate')
  @Roles(Role.DRIVER, Role.ADMIN)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Activate a vehicle' })
  @ApiParam({ name: 'id', description: 'Vehicle UUID' })
  @ApiOkResponse({ description: 'Vehicle activated successfully.' })
  async activate(@Param('id') id: string, @CurrentUser() principal: Principal) {
    await this.assertOwnsVehicle(principal, id, 'activate your own vehicles');
    const vehicle = await this.vehiclesService.activate(id);
    return enveloped(vehicle, 'Vehicle activated successfully');
  }

  @Patch(':id')
  @Roles(Role.DRIVER, Role.ADMIN)
  @ApiOperation({ summary: 'Update vehicle details' })
  @ApiParam({ name: 'id', description: 'Vehicle UUID' })
  @ApiBody({ type: UpdateVehicleDto })
  @ApiOkResponse({ description: 'Vehicle updated successfully.' })
  async update(
    @Param('id') id: string,
    @Body() updateVehicleDto: UpdateVehicleDto,
    @CurrentUser() principal: Principal,
  ) {
    await this.assertOwnsVehicle(principal, id, 'update your own vehicles');
    const vehicle = await this.vehiclesService.update(id, updateVehicleDto);
    return enveloped(vehicle, 'Vehicle updated successfully');
  }

  @Delete(':id')
  @Roles(Role.DRIVER, Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Delete a vehicle' })
  @ApiParam({ name: 'id', description: 'Vehicle UUID' })
  @ApiNoContentResponse({ description: 'Vehicle deleted successfully.' })
  async remove(@Param('id') id: string, @CurrentUser() principal: Principal) {
    await this.assertOwnsVehicle(principal, id, 'delete your own vehicles');
    await this.vehiclesService.remove(id);
    // 204 carries no body — the object that used to be returned here was
    // discarded by Express and the client silently received nothing.
  }

  /**
   * Load the vehicle and check the caller owns it.
   *
   * A read before every mutation is the cost of not having the owner in the
   * URL. `findOne` throws NotFound for a missing id, which is the same answer
   * a stranger's id should get anyway, so this leaks nothing extra.
   */
  private async assertOwnsVehicle(
    principal: Principal,
    vehicleId: string,
    action: string,
  ): Promise<void> {
    const vehicle = await this.vehiclesService.findOne(vehicleId);
    assertOwnership(principal, vehicle.driverId, action);
  }
}
