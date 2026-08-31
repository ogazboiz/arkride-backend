import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RidesService } from './rides.service';
import { RidesController } from './rides.controller';
import { RatingsService } from './ratings.service';
import { RatingsController } from './ratings.controller';
import { Ride } from './entities/ride.entity';
import { Rating } from './entities/rating.entity';
import { User } from '../users/entities/user.entity';
import { Driver } from '../drivers/entities/driver.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';

/**
 * Rides Module
 * Manages all ride-related functionality
 * Imports User, Driver, and Vehicle entities for relationships and validation
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Ride, Rating, User, Driver, Vehicle]),
  ],
  controllers: [RidesController, RatingsController],
  providers: [RidesService, RatingsService],
  exports: [RidesService, RatingsService], // Export for use in other modules (e.g., Wallet)
})
export class RidesModule {}
