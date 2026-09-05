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
  Req,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DriversService } from './drivers.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import { UpdateDriverOnlineStatusDto } from './dto/update-driver-online-status.dto';
import {
  UpdateVerificationStatusDto,
  UpdateDriverActiveStatusDto,
} from './dto/admin-update-driver-status.dto';
import { DriverForgotPasswordDto } from './dto/forgot-password.dto';
import { DriverResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { VerificationStatus } from './entities/driver.entity';
import { assertOwnership, isAdmin } from '../common/utils/ownership.util';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { Principal } from '../common/utils/ownership.util';
import { DriverLoginDto } from './dto/driver-login.dto';
import {
  ApiBearerAuth,
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { enveloped } from '../common/dto/api-response';

@ApiTags('Drivers')
@Controller('api/v1/drivers')
export class DriversController {
  private readonly logger = new Logger(DriversController.name);

  constructor(private readonly driversService: DriversService) {}

  @Throttle({ short: { limit: 3, ttl: 1_000 }, medium: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new driver' })
  @ApiBody({ type: CreateDriverDto })
  @ApiOkResponse({ description: 'Driver registration successful.' })
  async create(@Body() createDriverDto: CreateDriverDto) {
    const result = await this.driversService.create(createDriverDto);
    // Spread the whole result. Cherry-picking `token` here silently dropped
    // `refreshToken` / `expiresIn`, so a driver who had just registered had a
    // one-hour session and no way to renew it.
    return enveloped(
      result,
      'Driver registration successful. You can now start using the app.',
    );
  }

  @Throttle({ short: { limit: 3, ttl: 1_000 }, medium: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Driver login' })
  @ApiBody({ type: DriverLoginDto })
  @ApiOkResponse({ description: 'Driver authenticated successfully.' })
  async login(@Body() loginDto: DriverLoginDto) {
    return await this.driversService.login(loginDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  async findAll() {
    const drivers = await this.driversService.findAll();
    return {
      count: drivers.length,
      drivers,
    };
  }

  /**
   * A driver's own record, or any driver's for an admin.
   *
   * Was `@Roles(DRIVER, ADMIN)` with no ownership check, so any driver could
   * read any other driver's email, phone, licence number, licence expiry and
   * wallet balance by iterating ids.
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DRIVER, Role.ADMIN)
  async findOne(
    @Param('id') id: string,
    @CurrentUser() principal: Principal,
  ) {
    assertOwnership(principal, id, 'view your own driver profile');
    return await this.driversService.findOne(id);
  }

  /**
   * Update a driver's own profile.
   *
   * Two independent holes were closed here. There was no ownership check, so
   * `@Roles(DRIVER, ADMIN)` meant *any* driver could PATCH *any* driver; and
   * UpdateDriverDto extended PartialType(CreateDriverDto) while also declaring
   * verificationStatus/isActive/isOnline, so the writable set included another
   * account's email and password and the driver's own approval state.
   *
   * Ownership is enforced here; the field allowlist is enforced by the DTO.
   * Both are needed — either alone still leaves an exploit.
   */
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DRIVER, Role.ADMIN)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: "Update a driver's own profile" })
  @ApiParam({ name: 'id', description: 'Driver UUID' })
  @ApiBody({ type: UpdateDriverDto })
  async update(
    @Param('id') id: string,
    @Body() updateDriverDto: UpdateDriverDto,
    @CurrentUser() principal: Principal,
  ) {
    assertOwnership(principal, id, 'update your own driver profile');
    const driver = await this.driversService.update(id, updateDriverDto);
    return enveloped(driver, 'Driver updated successfully');
  }

  @Patch(':id/online-status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DRIVER)
  async updateOnlineStatus(
    @Param('id') id: string,
    @Body() updateOnlineStatusDto: UpdateDriverOnlineStatusDto,
    @Req() req,
  ) {
    this.logger.log({
      message: 'Driver online status update requested',
      driverIdParam: id,
      authenticatedUserId: req.user?.id,
      authenticatedUserRole: req.user?.role,
      bodyKeys: Object.keys(updateOnlineStatusDto ?? {}),
      isOnline: updateOnlineStatusDto?.isOnline,
      isOnlineType: typeof updateOnlineStatusDto?.isOnline,
    });

    // Was a hand-rolled `req.user.id !== id`, which had no admin escape and so
    // silently contradicted ownership.util's stated rule that an admin may act
    // on anything. The whole point of that file is that these stop being
    // written per handler.
    assertOwnership(req.user, id, 'update your own online status');

    const driver = await this.driversService.updateOnlineStatus(
      id,
      !!updateOnlineStatusDto?.isOnline,
    );

    this.logger.log({
      message: 'Driver online status update completed',
      driverId: driver.id,
      isOnline: driver.isOnline,
    });

    return enveloped(driver, `Driver is now ${updateOnlineStatusDto.isOnline ? 'online' : 'offline'}`);
  }

  @Patch(':id/verification-status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  async updateVerificationStatus(
    @Param('id') id: string,
    // Was `@Body('status') status: VerificationStatus`. class-validator never
    // runs on a `@Body('key')` parameter, so any string at all was written
    // straight into the enum column.
    @Body() dto: UpdateVerificationStatusDto,
  ) {
    const driver = await this.driversService.updateVerificationStatus(
      id,
      dto.status,
    );
    return enveloped(driver, 'Verification status updated successfully');
  }

  /**
   * Suspend or reinstate a driver.
   *
   * `isActive` used to be reachable through `PATCH /drivers/:id` by the driver
   * themselves. It belongs to admins, and only to admins.
   */
  @Patch(':id/active-status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Suspend or reinstate a driver (admin)' })
  @ApiParam({ name: 'id', description: 'Driver UUID' })
  @ApiBody({ type: UpdateDriverActiveStatusDto })
  async updateActiveStatus(
    @Param('id') id: string,
    @Body() dto: UpdateDriverActiveStatusDto,
  ) {
    const driver = await this.driversService.updateActiveStatus(
      id,
      dto.isActive,
      dto.reason,
    );
    return enveloped(driver, `Driver ${dto.isActive ? 'reinstated' : 'suspended'} successfully`);
  }

  @Throttle({ short: { limit: 3, ttl: 1_000 }, medium: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: DriverForgotPasswordDto) {
    return await this.driversService.forgotPassword(dto);
  }

  @Throttle({ short: { limit: 3, ttl: 1_000 }, medium: { limit: 5, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: DriverResetPasswordDto) {
    return await this.driversService.resetPassword(dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Delete a driver' })
  @ApiParam({ name: 'id', description: 'Driver UUID' })
  @ApiNoContentResponse({ description: 'Driver deleted successfully.' })
  async remove(@Param('id') id: string) {
    await this.driversService.remove(id);
    return {
        message: "Driver deleted successfully"
    }
  }
}
