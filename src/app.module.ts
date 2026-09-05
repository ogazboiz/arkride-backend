import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { DriversModule } from './drivers/drivers.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { RidesModule } from './rides/rides.module';
import { DriverLocationsModule } from './driver-locations/driver-locations.module';
import ormconfig from './ormconfig';
import { SecurityModule } from './security/security.module';
import { DatabaseService } from './common/services/database.service';
import { RedisModule } from './redis/redis.module';
import { CommonModule } from './common/common.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { LedgerModule } from './ledger/ledger.module';
import { WebsocketModule } from './websocket/websocket.module';
import { WalletModule } from './wallet/wallet.module';
import { EmergencyModule } from './emergency/emergency.module';
import { BookingChannelsModule } from './booking-channels/booking-channels.module';

@Module({
  imports: [
    // Load environment variables globally
    ConfigModule.forRoot({ isGlobal: true }),

    // Initialize our centralized Redis management
    RedisModule,

    // Initialize shared common services (Email, etc.)
    CommonModule,

    /**
     * Domain Events
     *
     * Services emit ride lifecycle events here and the websocket gateway
     * listens. This indirection is what lets realtime updates happen without
     * the domain layer ever importing the transport layer.
     */
    EventEmitterModule.forRoot(),

    /**
     * Rate limiting lives in SecurityModule, which is where the APP_GUARD is
     * provided. A second registration used to sit here; because Nest resolves
     * the guard's options from the module that provides it, this one never
     * took effect and only made the real limit hard to find.
     */

    // Database Configuration
    TypeOrmModule.forRoot(ormconfig),
    
    // Feature Modules
    SecurityModule,
    UsersModule,
    AuthModule,
    DriversModule,
    VehiclesModule,
    RidesModule,
    DriverLocationsModule,
    LedgerModule,
    WalletModule,
    EmergencyModule,
    BookingChannelsModule,

    // Realtime transport (leaf module — nothing imports it)
    WebsocketModule,
  ],
  controllers: [AppController],
  providers: [AppService, DatabaseService],
  exports: [DatabaseService],
})
export class AppModule { }
