import { ConfigService } from '@nestjs/config';
import type { JwtModuleOptions } from '@nestjs/jwt';

/**
 * One definition of how this service signs and verifies tokens.
 *
 * There used to be two `JwtModule.registerAsync` blocks — one in AuthModule for
 * riders, one in DriversModule for drivers — plus two more places reading the
 * secret by hand (the passport strategy and the websocket gateway). All four
 * spelled the fallback `|| 'your-secret-key'`, so a missing secret degraded
 * silently into a publicly known key rather than failing.
 *
 * Now there is one reader, it throws, and the four call sites share it.
 */

/** Access tokens are short. Revocation is handled by the refresh-token store. */
export const ACCESS_TOKEN_TTL = '1h';

/**
 * The signing secret, or an exception.
 *
 * `validateEnvironment()` runs first in bootstrap and normally catches this,
 * so reaching the throw here means something constructed the module outside
 * the normal boot path — a test, or a future entrypoint. Failing loudly is
 * still the right answer in both.
 */
export function requireJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');

  if (!secret || secret.trim().length === 0) {
    throw new Error(
      'JWT_SECRET is not set. Refusing to sign tokens with a default — ' +
        'see .env.example.',
    );
  }

  return secret;
}

/** The shared `JwtModule.registerAsync` factory. */
export function jwtModuleOptions(config: ConfigService): JwtModuleOptions {
  return {
    secret: requireJwtSecret(config),
    signOptions: {
      expiresIn: ACCESS_TOKEN_TTL,
      issuer: 'arkrides',
    },
    verifyOptions: {
      issuer: 'arkrides',
    },
  };
}
