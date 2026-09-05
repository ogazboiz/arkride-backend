import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EmergencyService } from './emergency.service';
import { TriggerEmergencyDto, ResolveEmergencyDto } from './dto/emergency.dto';
import { EmergencyStatus } from './entities/emergency-incident.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { assertPartyToRide } from '../common/utils/ownership.util';
import type { Principal } from '../common/utils/ownership.util';
import { enveloped } from '../common/dto/api-response';

/**
 * Emergency Controller
 *
 * The in-ride SOS system. Available to both riders and drivers, but only for
 * the ride they are actually in, and only while it is in progress.
 */
@ApiTags('Emergency')
@Controller('api/v1/emergency')
export class EmergencyController {
  constructor(private readonly emergencyService: EmergencyService) {}

  /**
   * POST /api/v1/emergency/trigger
   *
   * Fires triggerEmergencyProtocol and broadcastLocation webhooks, and pushes
   * a realtime alert to both parties and the ops room.
   */
  @Post('trigger')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.USER, Role.DRIVER)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Raise an in-ride SOS' })
  @ApiBody({ type: TriggerEmergencyDto })
  async trigger(@Body() dto: TriggerEmergencyDto, @Request() req: any) {
    const incident = await this.emergencyService.trigger(
      dto,
      req.user.id,
      req.user.role,
    );

    return enveloped(incident, 'Emergency protocol triggered. Help is being notified.');
  }

  /**
   * GET /api/v1/emergency/incidents
   */
  @Get('incidents')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'List emergency incidents' })
  async findAll(@Query('status') status?: EmergencyStatus) {
    const incidents = await this.emergencyService.findAll(status);
    return { count: incidents.length, incidents };
  }

  /**
   * GET /api/v1/emergency/ride/:rideId
   */
  @Get('ride/:rideId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.USER, Role.DRIVER, Role.ADMIN)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Get incidents raised on a ride' })
  async findByRide(
    @Param('rideId') rideId: string,
    @CurrentUser() principal: Principal,
  ) {
    // This handler's own docblock said "only for the ride they are actually
    // in", but nothing checked it. Any authenticated account could read any
    // SOS incident — which carries the victim's live coordinates.
    const ride = await this.emergencyService.findRideForAuthorization(rideId);
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }
    assertPartyToRide(principal, ride, 'view emergency incidents');

    const incidents = await this.emergencyService.findByRideId(rideId);
    return { count: incidents.length, incidents };
  }

  /**
   * PATCH /api/v1/emergency/incidents/:id/resolve
   */
  @Patch('incidents/:id/resolve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Close out an emergency incident' })
  async resolve(@Param('id') id: string, @Body() dto: ResolveEmergencyDto) {
    const incident = await this.emergencyService.resolve(id, dto);
    return enveloped(incident, 'Incident updated');
  }
}
