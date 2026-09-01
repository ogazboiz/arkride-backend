import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { BookingChannelsService } from './booking-channels.service';
import { BookingChannelsController } from './booking-channels.controller';
import { User } from '../users/entities/user.entity';
import { RidesModule } from '../rides/rides.module';
import { RIDE_REQUEST_PARSER } from './parsers/ride-request-parser.interface';
import { RuleBasedRideParser } from './parsers/rule-based-ride-parser.service';
import { GEOCODING_PROVIDER } from './geocoding/geocoding.provider';
import { LandmarkGeocodingProvider } from './geocoding/geocoding.provider';

/**
 * Booking Channels Module
 *
 * WhatsApp and voice bookings. Imports RidesModule so bookings go through the
 * app's own createRide() rather than a parallel implementation.
 *
 * Both the parser and the geocoder are bound behind tokens so a real NLP
 * service and a real Maps client can replace the placeholder implementations
 * without touching BookingChannelsService.
 */
@Module({
  imports: [TypeOrmModule.forFeature([User]), RidesModule, ConfigModule],
  controllers: [BookingChannelsController],
  providers: [
    BookingChannelsService,
    { provide: RIDE_REQUEST_PARSER, useClass: RuleBasedRideParser },
    { provide: GEOCODING_PROVIDER, useClass: LandmarkGeocodingProvider },
  ],
  exports: [BookingChannelsService],
})
export class BookingChannelsModule {}
