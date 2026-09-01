import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmergencyService } from './emergency.service';
import { EmergencyController } from './emergency.controller';
import { EmergencyIncident } from './entities/emergency-incident.entity';
import { Ride } from '../rides/entities/ride.entity';
import { DriverLocationsModule } from '../driver-locations/driver-locations.module';

/**
 * Emergency Module
 *
 * In-ride SOS. Reads the Ride table directly rather than importing RidesModule,
 * because all it needs is the ride's status and its two participants — pulling
 * in the whole rides service would couple the safety path to ride business
 * logic it has no reason to depend on.
 *
 * WebhookService comes from the global CommonModule; EventEmitter2 is global.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([EmergencyIncident, Ride]),
    DriverLocationsModule,
  ],
  controllers: [EmergencyController],
  providers: [EmergencyService],
  exports: [EmergencyService],
})
export class EmergencyModule {}
