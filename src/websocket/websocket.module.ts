import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { Ride } from '../rides/entities/ride.entity';
import { RidesGateway } from './gateways/rides.gateway';

/**
 * Websocket Module
 *
 * The realtime transport layer. It is a leaf: nothing else in the app imports
 * it, because state reaches it through EventEmitter2 rather than direct calls.
 *
 * AuthModule supplies JwtModule and AuthResolverService for handshake auth.
 * The Vehicle repository is needed to work out which broadcast rooms a
 * connecting driver belongs in.
 */
@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([Vehicle, Ride])],
  providers: [RidesGateway],
})
export class WebsocketModule {}
