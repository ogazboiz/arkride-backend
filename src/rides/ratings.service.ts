import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Rating } from '../rides/entities/rating.entity';
import { CreateRatingDto } from '../rides/dto/create-rating.dto';
import { Ride, RideStatus } from '../rides/entities/ride.entity';
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

  /**
   * Rate the other party on a completed ride.
   *
   * Four invariants, all of which were missing. The only check that existed
   * was "the rater was on this ride", which left every one of these open:
   *
   *   1. The ride must be COMPLETED. You could previously rate a ride the
   *      moment you requested it, before a driver had even accepted.
   *   2. The ratee must be the OTHER party. `rateeId` was written verbatim, so
   *      a driver could rate themselves 5, or rate an arbitrary UUID.
   *   3. `rateeType` must match who that is. Rating the driver but claiming
   *      `rateeType: 'user'` wrote into the wrong average.
   *   4. One rating per rater per ride. Nothing stopped a loop, and every
   *      write recomputed AVG(), so a rating was a dial rather than a vote.
   */
  async create(raterId: string, createRatingDto: CreateRatingDto): Promise<Rating> {
    const { rideId, rateeId, rateeType, rating, comment } = createRatingDto;

    const ride = await this.ridesRepository.findOne({ where: { id: rideId } });
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }

    const raterIsRider = ride.userId === raterId;
    const raterIsDriver = !!ride.driverId && ride.driverId === raterId;

    if (!raterIsRider && !raterIsDriver) {
      throw new ForbiddenException('You were not part of this ride');
    }

    // (1) Only completed rides can be rated.
    if (ride.status !== RideStatus.COMPLETED) {
      throw new BadRequestException(
        `Only completed rides can be rated. This ride is ${ride.status}.`,
      );
    }

    // (2) + (3) The ratee is determined by who the rater is, not by the body.
    // The request still has to name them correctly — silently overwriting
    // would let a client believe it rated someone it did not.
    const expectedRateeId = raterIsRider ? ride.driverId : ride.userId;
    const expectedRateeType: 'user' | 'driver' = raterIsRider ? 'driver' : 'user';

    if (!expectedRateeId) {
      throw new BadRequestException(
        'This ride has no counterparty to rate.',
      );
    }

    if (rateeId !== expectedRateeId || rateeType !== expectedRateeType) {
      throw new BadRequestException(
        'You can only rate the other party on this ride.',
      );
    }

    // (4) One per rater per ride. The unique index on (rideId, raterId) is the
    // real guarantee under concurrency; this is the readable error.
    const existing = await this.ratingsRepository.findOne({
      where: { rideId, raterId },
    });
    if (existing) {
      throw new ConflictException('You have already rated this ride.');
    }

    const ratingEntry = this.ratingsRepository.create({
      rideId,
      raterId,
      rateeId: expectedRateeId,
      rateeType: expectedRateeType,
      rating,
      comment,
    });

    await this.ratingsRepository.save(ratingEntry);

    // Recompute the ratee's average from the derived identity, not the body.
    if (expectedRateeType === 'driver') {
      await this.updateDriverRating(expectedRateeId);
    } else {
      await this.updateUserRating(expectedRateeId);
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

  /**
   * Ratings on one ride.
   *
   * The controller checks that the caller is a party to the ride before
   * calling this — the endpoint used to carry NO guard at all, so anyone on
   * the internet could walk ride ids and read rater/ratee UUIDs and free-text
   * comments.
   */
  async findByRide(rideId: string): Promise<Rating[]> {
    return this.ratingsRepository.find({
      where: { rideId },
      order: { createdAt: 'ASC' },
    });
  }

  /** The ride, for the controller's party check. Null when it does not exist. */
  async findRideForAuthorization(
    rideId: string,
  ): Promise<{ userId: string; driverId: string | null } | null> {
    const ride = await this.ridesRepository.findOne({
      where: { id: rideId },
      select: { userId: true, driverId: true },
    });
    return ride ? { userId: ride.userId, driverId: ride.driverId } : null;
  }
}
