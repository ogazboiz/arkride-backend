import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { TokenService } from './token.service';
import { isTest } from '../../config/environment';

/** How often expired refresh tokens are swept. */
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // six hours

/** First sweep is delayed so it never competes with application startup. */
const FIRST_SWEEP_DELAY_MS = 60 * 1000;

/**
 * Deletes refresh tokens that expired long enough ago to be useless.
 *
 * `TokenService.pruneExpired` existed with no caller at all, so nothing ever
 * removed a row: `refresh_tokens` grew for the life of the deployment, and the
 * unique index on `tokenHash` grew with it.
 *
 * Deliberately a plain interval rather than @nestjs/schedule — one dependency
 * fewer for one timer — and deliberately `unref()`d, so a pending sweep can
 * never be the reason the process refuses to exit. It is also stopped on module
 * destroy, because a timer that outlives its module is how a test suite ends up
 * warning about open handles.
 *
 * Every replica runs this. Deleting an already-deleted row is a no-op, so
 * concurrent sweeps are harmless and no lock is warranted for a housekeeping
 * task that runs four times a day.
 */
@Injectable()
export class TokenCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TokenCleanupService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly tokens: TokenService) {}

  onModuleInit(): void {
    // Tests should not have a background timer firing against a mock.
    if (isTest()) return;

    this.timer = setInterval(() => {
      void this.sweep();
    }, SWEEP_INTERVAL_MS);
    this.timer.unref();

    const first = setTimeout(() => void this.sweep(), FIRST_SWEEP_DELAY_MS);
    first.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Never throws. A failed sweep is a housekeeping problem, and an unhandled
   * rejection from a background timer would take the process down over one.
   */
  async sweep(): Promise<void> {
    try {
      const deleted = await this.tokens.pruneExpired();
      if (deleted > 0) {
        this.logger.log(`Pruned ${deleted} expired refresh tokens`);
      }
    } catch (error) {
      this.logger.warn({
        message: 'Refresh token prune failed; will retry on the next sweep',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
