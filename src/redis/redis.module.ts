import { Global, Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Keyv } from 'keyv';
import KeyvRedis from '@keyv/redis';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';
import {
  redisConnection,
  redisConnectionUrl,
} from '../config/redis.config';

/**
 * RedisModule
 * 
 * Purpose: Centralized Redis management for the entire application.
 * 
 * Why this exists:
 * 1. Speed: Shared connection pool prevents overhead of opening multiple connections.
 * 2. Scalability: Powers distributed rate limiting and real-time tracking.
 * 3. Reliability: Handles background jobs (BullMQ) and caching.
 */
@Global()
@Module({
  imports: [
    // 1. Caching Configuration
    // Uses Redis as the storage for application-wide caching
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        // Was built by hand WITHOUT the password, so it could only ever
        // reach an unauthenticated Redis. Every managed Redis requires auth.
        const redisUrl = redisConnectionUrl(configService);
        
        return {
          stores: [
            new Keyv({
              store: new KeyvRedis(redisUrl),
            }),
          ],
          ttl: 600000, // 10 minutes default cache time
        };
      },
    }),

    // 2. Queue Configuration (BullMQ)
    // Connects background workers to Redis
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const { host, port, password, username, tls } =
          redisConnection(configService);

        return {
          connection: {
            host,
            port,
            ...(password ? { password } : {}),
            ...(username ? { username } : {}),
            // `rediss://` means the provider terminates TLS.
            ...(tls ? { tls: {} } : {}),
          },
        };
      },
    }),

    // Registering specific queues for different background tasks
    BullModule.registerQueue(
      { name: 'email' },         // For sending OTPs/Welcome emails without blocking the user
      { name: 'notifications' },  // For push notifications
      { name: 'ride-status' },    // For processing complex ride state changes
    ),
  ],
  providers: [
    /**
     * Shared Redis Client Provider
     * 
     * Why we do this:
     * Instead of letting every library (BullMQ, Throttler, Cache) create its own
     * separate connection, we create ONE 'ioredis' instance and share it.
     * This is crucial for high-performance apps to prevent hitting Redis connection limits.
     */
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const { host, port, password, username, tls } =
          redisConnection(configService);

        return new Redis({
          host,
          port,
          ...(password ? { password } : {}),
          ...(username ? { username } : {}),
          ...(tls ? { tls: {} } : {}),
          // BullMQ requires this; without it a blocking command that loses the
          // connection throws instead of reconnecting.
          maxRetriesPerRequest: null,
        });
      },
    },
  ],
  // Exporting both BullModule and our shared REDIS_CLIENT so other modules can use them
  exports: [CacheModule, BullModule, REDIS_CLIENT],
})
export class RedisModule {}
