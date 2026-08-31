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
import { REDIS_CLIENT } from './redis/redis.constants';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';

@Module({
  imports: [
    // Load environment variables globally
    ConfigModule.forRoot({ isGlobal: true }),

    // Initialize our centralized Redis management
    RedisModule,

    // Initialize shared common services (Email, etc.)
    CommonModule,

    /**
     * Rate Limiting Configuration (Throttler)
     */
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule, RedisModule],
      inject: [ConfigService, REDIS_CLIENT],
      useFactory: (config: ConfigService, redis) => ({
        storage: new ThrottlerStorageRedisService(redis),
        throttlers: [
          {
            name: 'default',
            ttl: 60000,
            limit: 100,
          },
        ],
      }),
    }),

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
  ],
  controllers: [AppController],
  providers: [AppService, DatabaseService],
  exports: [DatabaseService],
})
export class AppModule { }
