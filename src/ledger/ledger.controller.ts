import {
  Controller,
  Get,
  Param,
  Query,
  Request,
  ForbiddenException,
  UseGuards,
} from '@nestjs/common';
import { clampLimit, clampOffset } from '../common/utils/pagination.util';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LedgerService } from './ledger.service';
import { StakeholderType } from './entities/ledger-entry.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

/**
 * Ledger Controller
 *
 * Read-only views over the financial audit trail. Nothing here mutates money —
 * entries are written by the services that actually move it (rides, wallet).
 *
 * The per-ride breakdown a rider or driver sees lives on RidesController
 * (GET /api/v1/rides/:id/breakdown) because that is where ride participation
 * can be checked without a circular dependency between the two modules.
 */
@ApiTags('Ledger')
@Controller('api/v1/ledger')
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  /**
   * The authenticated caller's own statement.
   * Works for both riders and drivers — the stakeholder type follows their role.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.USER, Role.DRIVER, Role.ADMIN)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Get my own ledger statement' })
  async getMyStatement(
    @Request() req: any,
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
  ) {
    const stakeholderType =
      req.user.role === Role.DRIVER
        ? StakeholderType.DRIVER
        : StakeholderType.RIDER;

    const { entries, total } = await this.ledgerService.findByStakeholder(
      stakeholderType,
      req.user.id,
      clampLimit(limit),
      clampOffset(offset),
    );

    return { stakeholderType, count: entries.length, total, entries };
  }

  /**
   * A specific driver's statement. Drivers may only read their own.
   */
  @Get('driver/:driverId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DRIVER, Role.ADMIN)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: "Get a driver's ledger statement" })
  async getDriverStatement(
    @Param('driverId') driverId: string,
    @Request() req: any,
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
  ) {
    if (req.user.role !== Role.ADMIN && req.user.id !== driverId) {
      throw new ForbiddenException('You can only view your own statement');
    }

    const { entries, total } = await this.ledgerService.findByStakeholder(
      StakeholderType.DRIVER,
      driverId,
      clampLimit(limit),
      clampOffset(offset),
    );

    return { count: entries.length, total, entries };
  }

  /**
   * Every entry produced by one ride (admin view)
   */
  @Get('ride/:rideId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Get all ledger entries for a ride' })
  async getRideEntries(@Param('rideId') rideId: string) {
    const entries = await this.ledgerService.findByRideId(rideId);
    return { count: entries.length, entries };
  }

  /**
   * Platform revenue and totals by entry type
   */
  @Get('summary')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Platform revenue summary' })
  async getSummary() {
    return await this.ledgerService.getSummary();
  }
}
