import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Get,
  Param,
  NotFoundException,
} from '@nestjs/common';
import { RatingsService } from './ratings.service';
import { CreateRatingDto } from './dto/create-rating.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { assertPartyToRide } from '../common/utils/ownership.util';
import type { Principal } from '../common/utils/ownership.util';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiOkResponse,
} from '@nestjs/swagger';

@ApiTags('Ratings')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/ratings')
export class RatingsController {
  constructor(private readonly ratingsService: RatingsService) {}

  /**
   * Rate the other party on a completed ride.
   *
   * The service decides who the ratee is from the ride and the caller's
   * identity; see RatingsService.create for the four invariants that were
   * missing and why each one mattered.
   */
  @Post()
  @Roles(Role.USER, Role.DRIVER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit a rating for a completed ride' })
  @ApiOkResponse({ description: 'Rating recorded.' })
  async create(
    @CurrentUser() principal: Principal,
    @Body() createRatingDto: CreateRatingDto,
  ) {
    return this.ratingsService.create(principal.id, createRatingDto);
  }

  /**
   * Ratings left on one ride.
   *
   * This endpoint previously had NO guard whatsoever — not even
   * JwtAuthGuard — so anyone who could guess or enumerate a ride UUID could
   * read the rater and ratee ids and the free-text comments on it.
   */
  @Get('ride/:rideId')
  @Roles(Role.USER, Role.DRIVER, Role.ADMIN)
  @ApiOperation({ summary: 'Get ratings for a ride you were part of' })
  @ApiParam({ name: 'rideId', description: 'Ride UUID' })
  async findByRide(
    @Param('rideId') rideId: string,
    @CurrentUser() principal: Principal,
  ) {
    const ride = await this.ratingsService.findRideForAuthorization(rideId);
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }
    assertPartyToRide(principal, ride, 'view ratings');
    return this.ratingsService.findByRide(rideId);
  }
}
