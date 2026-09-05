import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '../redis/redis.module';
import { REDIS_CLIENT } from '../redis/redis.constants';

/**
 * Rate limiting.
 *
 * WHAT WAS WRONG
 *
 * There were TWO ThrottlerModule registrations. This module registered an
 * in-memory one (10 requests / 60s, unnamed) and provided the APP_GUARD;
 * AppModule separately registered a Redis-backed one (100 / 60s, named
 * 'default'). Because the guard is provided HERE, Nest resolved THIS module's
 * options — so the Redis-backed configuration was dead code and the live limit
 * was 10 requests per minute per IP, held in the memory of a single process.
 *
 * Two consequences, both bad in opposite directions:
 *   - 10/min is unusable for a mobile ride app. A rider opening the app,
 *     estimating a fare and booking spends most of that budget immediately.
 *   - In-memory means the limit is per REPLICA, so it does not actually bound
 *     anything once the service scales past one container.
 *
 * And `@Throttle({ short: { ... } })` on POST /auth/login named a throttler
 * called 'short' that existed in NEITHER configuration, so the strict
 * login-specific limit silently did nothing — the one endpoint that most
 * needed it was on the general limit.
 *
 * WHAT IT IS NOW
 *
 * One registration, in the module that owns the guard, backed by the shared
 * Redis client so the limit is global across replicas, with three NAMED
 * throttlers. Every named throttler applies to every request unless a handler
 * overrides one by name, which is what makes `short` usable as the burst
 * clamp on credential endpoints.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule, RedisModule],
      inject: [REDIS_CLIENT],
      useFactory: (redis: unknown) => ({
        // Shared across replicas. A per-process counter is not a rate limit.
        storage: new ThrottlerStorageRedisService(redis as never),
        throttlers: [
          {
            // Burst clamp. Named so credential endpoints can tighten it with
            // @Throttle({ short: { ... } }) — the name has to exist here or
            // the override is a no-op, which is exactly what happened before.
            name: 'short',
            ttl: 1_000,
            limit: 10,
          },
          {
            // The normal working limit for an authenticated app session.
            name: 'medium',
            ttl: 60_000,
            limit: 120,
          },
          {
            // Backstop against slow, patient scraping that stays under the
            // per-minute limit all day.
            name: 'long',
            ttl: 3_600_000,
            limit: 2_000,
          },
        ],
      }),
    }),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class SecurityModule {}
