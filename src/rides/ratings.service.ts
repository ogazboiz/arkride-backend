import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Rating } from '../rides/entities/rating.entity';
import { CreateRatingDto } from '../rides/dto/create-rating.dto';
import { Ride } from '../rides/entities/ride.entity';
import { Driver } from '../drivers/entities/driver.entity';
import { User } from '../users/entities/user.entity';

@Injectable()
export class RatingsService {
  constructor(
    @InjectRepository(Rating)
    private readonly ratingsRepository: Repository<Rating>,
    @InjectRepository(Ride)
    private readonly ridesRepository: Repository<Ride>,
    @InjectRepository(Driver)
    private readonly driversRepository: Repository<Driver>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async create(raterId: string, createRatingDto: CreateRatingDto): Promise<Rating> {
    const { rideId, rateeId, rateeType, rating, comment } = createRatingDto;

    // Check if ride exists
    const ride = await this.ridesRepository.findOne({ where: { id: rideId } });
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }

    // Check if rater is part of the ride
    if (ride.userId !== raterId && ride.driverId !== raterId) {
      throw new BadRequestException('You were not part of this ride');
    }

    // Create the rating
    const ratingEntry = this.ratingsRepository.create({
      rideId,
      raterId,
      rateeId,
      rateeType,
      rating,
      comment,
    });

    await this.ratingsRepository.save(ratingEntry);

    // Update ratee average
    if (rateeType === 'driver') {
      await this.updateDriverRating(rateeId);
    } else {
      await this.updateUserRating(rateeId);
    }

    return ratingEntry;
  }

  private async updateDriverRating(driverId: string) {
    const { avg } = await this.ratingsRepository
      .createQueryBuilder('rating')
      .select('AVG(rating.rating)', 'avg')
      .where('rating.rateeId = :driverId', { driverId })
      .andWhere('rating.rateeType = :type', { type: 'driver' })
      .getRawOne();

    await this.driversRepository.update(driverId, {
      ratingAverage: parseFloat(avg) || 0,
    });
  }

  private async updateUserRating(userId: string) {
    const { avg } = await this.ratingsRepository
      .createQueryBuilder('rating')
      .select('AVG(rating.rating)', 'avg')
      .where('rating.rateeId = :userId', { userId })
      .andWhere('rating.rateeType = :type', { type: 'user' })
      .getRawOne();

    await this.usersRepository.update(userId, {
      ratingAverage: parseFloat(avg) || 0,
    });
  }

  async findByRide(rideId: string): Promise<Rating[]> {
    return this.ratingsRepository.find({ where: { rideId } });
  }
}
