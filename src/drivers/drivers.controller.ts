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
import { DriversService } from './drivers.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import { UpdateDriverOnlineStatusDto } from './dto/update-driver-online-status.dto';
import { DriverForgotPasswordDto } from './dto/forgot-password.dto';
import { DriverResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { VerificationStatus } from './entities/driver.entity';
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

@ApiTags('Drivers')
@Controller('api/v1/drivers')
export class DriversController {
  private readonly logger = new Logger(DriversController.name);

  constructor(private readonly driversService: DriversService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new driver' })
  @ApiBody({ type: CreateDriverDto })
  @ApiOkResponse({ description: 'Driver registration successful.' })
  async create(@Body() createDriverDto: CreateDriverDto) {
    const result = await this.driversService.create(createDriverDto);
    return {
      message: 'Driver registration successful. You can now start using the app.',
      driver: result.driver,
      token: result.token,
    };
  }

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

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DRIVER, Role.ADMIN)
  async findOne(@Param('id') id: string) {
    return await this.driversService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DRIVER, Role.ADMIN)
  async update(
    @Param('id') id: string,
    @Body() updateDriverDto: UpdateDriverDto,
  ) {
    const driver = await this.driversService.update(id, updateDriverDto);
    return {
      message: 'Driver updated successfully',
      driver,
    };
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

    if (req.user.id !== id) {
      this.logger.warn({
        message: 'Driver online status update denied: user can only update own status',
        driverIdParam: id,
        authenticatedUserId: req.user?.id,
        authenticatedUserRole: req.user?.role,
      });

      throw new ForbiddenException('You can only update your own online status');
    }

    const driver = await this.driversService.updateOnlineStatus(
      id,
      !!updateOnlineStatusDto?.isOnline,
    );

    this.logger.log({
      message: 'Driver online status update completed',
      driverId: driver.id,
      isOnline: driver.isOnline,
    });

    return {
      message: `Driver is now ${updateOnlineStatusDto.isOnline ? 'online' : 'offline'}`,
      driver,
    };
  }

  @Patch(':id/verification-status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  async updateVerificationStatus(
    @Param('id') id: string,
    @Body('status') status: VerificationStatus,
  ) {
    const driver = await this.driversService.updateVerificationStatus(id, status);
    return {
      message: 'Verification status updated successfully',
      driver,
    };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: DriverForgotPasswordDto) {
    return await this.driversService.forgotPassword(dto);
  }

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
