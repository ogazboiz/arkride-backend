import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { StatsService } from './stats.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Role } from '../common/enums/role.enum';

/**
 * Analytics.
 *
 * One endpoint is public and the rest are admin-only, and the split is
 * deliberate rather than incidental: `/public` returns counts and place names
 * for the marketing site, while everything else exposes revenue, driver
 * earnings and supply position — i.e. exactly what a competitor would want.
 */
@ApiTags('Stats')
@Controller('api/v1/stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  /**
   * Marketing numbers. No authentication.
   *
   * Throttled harder than an authenticated route because it is anonymous and
   * every field is an aggregate — cheap for a caller to request, not cheap to
   * serve.
   */
  @Get('public')
  @Public()
  @Throttle({ medium: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Public headline numbers for the marketing site' })
  @ApiOkResponse({ description: 'Public stats.' })
  getPublicStats() {
    return this.statsService.getPublicStats();
  }

  @Get('dashboard')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Admin overview' })
  getDashboard() {
    return this.statsService.getDashboard();
  }

  @Get('rides')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Ride volume, mix, timing and demand hotspots' })
  getRideStats() {
    return this.statsService.getRideStats();
  }

  @Get('revenue')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary:
      'Financial position, derived from the ledger rather than from rides',
  })
  getRevenueStats() {
    return this.statsService.getRevenueStats();
  }

  @Get('drivers')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Supply: verification funnel, availability, earnings',
  })
  getDriverStats() {
    return this.statsService.getDriverStats();
  }
}
