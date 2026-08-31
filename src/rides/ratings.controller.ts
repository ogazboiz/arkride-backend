import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Get,
  Param,
} from '@nestjs/common';
import { RatingsService } from './ratings.service';
import { CreateRatingDto } from './dto/create-rating.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Ratings')
@Controller('api/v1/ratings')
export class RatingsController {
  constructor(private readonly ratingsService: RatingsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit a rating for a ride' })
  async create(@Request() req: any, @Body() createRatingDto: CreateRatingDto) {
    const raterId = req.user.id;
    return this.ratingsService.create(raterId, createRatingDto);
  }

  @Get('ride/:rideId')
  @ApiOperation({ summary: 'Get ratings for a specific ride' })
  async findByRide(@Param('rideId') rideId: string) {
    return this.ratingsService.findByRide(rideId);
  }
}
