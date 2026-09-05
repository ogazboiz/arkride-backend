import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StatsService } from './stats.service';
import { StatsController } from './stats.controller';
import { Ride } from '../rides/entities/ride.entity';
import { Driver } from '../drivers/entities/driver.entity';
import { User } from '../users/entities/user.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { LedgerEntry } from '../ledger/entities/ledger-entry.entity';

/**
 * Analytics.
 *
 * Read-only and repository-only: it deliberately does not depend on
 * RidesService, WalletService or LedgerService. Reporting must never be able to
 * move money or change a ride, and taking only repositories makes that a
 * property of the wiring rather than a rule someone has to remember.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Ride, Driver, User, Vehicle, LedgerEntry]),
  ],
  controllers: [StatsController],
  providers: [StatsService],
  exports: [StatsService],
})
export class StatsModule {}
