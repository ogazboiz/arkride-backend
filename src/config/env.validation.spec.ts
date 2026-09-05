import { collectEnvProblems, collectEnvWarnings } from './env.validation';

/** A 32+ char secret, so length is never the reason a case fails. */
const GOOD_SECRET = 'a'.repeat(48);

/** Everything a production boot needs, so each test can remove exactly one thing. */
function completeProdEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    JWT_SECRET: GOOD_SECRET,
    INTERNAL_API_KEY: 'internal-key-value',
    REDIS_HOST: 'redis',
    SENDGRID_API_KEY: 'SG.xxx',
    SENDGRID_FROM_EMAIL: 'no-reply@arkrides.com',
    DATABASE_URL: 'postgres://user:pass@host:5432/db',
  };
}

describe('environment validation', () => {
  describe('JWT_SECRET — the reason this file exists', () => {
    it('rejects a missing secret even in development', () => {
      // The old code fell back to the literal string 'your-secret-key' here,
      // in every environment, and booted. That is the auth bypass.
      const problems = collectEnvProblems({ NODE_ENV: 'development' });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('JWT_SECRET');
    });

    it('rejects the exact placeholder the old fallback used', () => {
      const problems = collectEnvProblems({
        NODE_ENV: 'development',
        JWT_SECRET: 'your-secret-key',
      });
      expect(problems.join()).toContain('JWT_SECRET');
    });

    it.each(['change-me', 'CHANGE-ME', 'secret', 'password', '   ', ''])(
      'rejects the placeholder %p regardless of casing or padding',
      (value) => {
        const problems = collectEnvProblems({
          NODE_ENV: 'development',
          JWT_SECRET: value,
        });
        expect(problems.join()).toContain('JWT_SECRET');
      },
    );

    it('rejects a secret shorter than 32 characters', () => {
      const problems = collectEnvProblems({
        NODE_ENV: 'development',
        JWT_SECRET: 'short-but-not-a-placeholder',
      });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/at least 32/);
    });

    it('accepts a long, non-placeholder secret', () => {
      expect(
        collectEnvProblems({
          NODE_ENV: 'development',
          JWT_SECRET: GOOD_SECRET,
        }),
      ).toEqual([]);
    });
  });

  describe('development stays runnable', () => {
    it('does not demand SendGrid, Redis or the internal key locally', () => {
      // A laptop with no SendGrid account must still boot, or people will
      // "fix" it by inventing values that then reach production.
      expect(
        collectEnvProblems({
          NODE_ENV: 'development',
          JWT_SECRET: GOOD_SECRET,
        }),
      ).toEqual([]);
    });

    it('REFUSES an absent NODE_ENV rather than assuming development', () => {
      // This was the fail-open. compose.yml sets nothing, so a production
      // container inheriting no NODE_ENV would have been treated as
      // development: Swagger served publicly, localhost allowlisted for CORS,
      // and every production-only check skipped — silently.
      const problems = collectEnvProblems({ JWT_SECRET: GOOD_SECRET });
      expect(problems.join()).toContain('NODE_ENV');
    });

    it.each(['prod', 'PRODUCTION', 'dev', 'staging '])(
      'rejects the near-miss NODE_ENV value %p',
      (value) => {
        // `NODE_ENV=prod` is not 'production', so it would skip every
        // production rule while looking entirely deliberate.
        const problems = collectEnvProblems({
          NODE_ENV: value,
          JWT_SECRET: GOOD_SECRET,
        });
        expect(problems.join()).toContain('NODE_ENV');
      },
    );

    it.each(['development', 'test', 'staging', 'production'])(
      'accepts the valid value %p',
      (value) => {
        const env = completeProdEnv();
        env.NODE_ENV = value;
        expect(collectEnvProblems(env)).toEqual([]);
      },
    );

    it('treats test the same as development', () => {
      expect(
        collectEnvProblems({ NODE_ENV: 'test', JWT_SECRET: GOOD_SECRET }),
      ).toEqual([]);
    });
  });

  describe('production is strict', () => {
    it('accepts a complete production environment', () => {
      expect(collectEnvProblems(completeProdEnv())).toEqual([]);
    });

    // Only what genuinely cannot be defaulted blocks a boot: NODE_ENV and
    // JWT_SECRET are security decisions, Redis carries ride locking and rate
    // limiting, and there is no app at all without a database.
    it.each(['REDIS_HOST'])('rejects production without %s', (key) => {
      const env = completeProdEnv();
      delete env[key];
      const problems = collectEnvProblems(env);
      expect(problems.join()).toContain(key);
    });

    // These gate ONE feature each. Blocking on them meant a deployment with no
    // SendGrid account could not start, which treated "password reset cannot
    // deliver its email" as equivalent to "there is no database".
    it.each([
      'INTERNAL_API_KEY',
      'SENDGRID_API_KEY',
      'SENDGRID_FROM_EMAIL',
    ])('starts without %s, and warns instead', (key) => {
      const env = completeProdEnv();
      delete env[key];

      expect(collectEnvProblems(env)).toEqual([]);
      expect(collectEnvWarnings(env).join()).toContain(key);
    });

    it('accepts discrete database parts instead of a URL', () => {
      const env = completeProdEnv();
      delete env.DATABASE_URL;
      env.DATABASE_HOST = 'postgres';
      expect(collectEnvProblems(env)).toEqual([]);
    });

    it('rejects production with neither DATABASE_URL nor DATABASE_HOST', () => {
      const env = completeProdEnv();
      delete env.DATABASE_URL;
      const problems = collectEnvProblems(env);
      expect(problems.join()).toMatch(/DATABASE_URL.*DATABASE_HOST/);
    });

    it('reports every problem at once rather than the first', () => {
      // Boot-fix-boot-fix is a miserable loop on a remote host.
      const problems = collectEnvProblems({ NODE_ENV: 'production' });
      // JWT_SECRET, REDIS_HOST, and the database. The feature-gating variables
      // are warnings now, so they are deliberately not counted here.
      expect(problems.length).toBeGreaterThanOrEqual(3);
    });

    it('explains what each missing variable breaks', () => {
      const problems = collectEnvProblems({ NODE_ENV: 'production' });
      // Every message carries a "— because" clause, not just a variable name.
      for (const problem of problems) {
        expect(problem).toMatch(/ — .+\.$/);
      }
    });
  });

  describe('warnings', () => {
    it('warns when CORS_ORIGINS is unset in production but does not block boot', () => {
      const warnings = collectEnvWarnings(completeProdEnv());
      expect(warnings.join()).toContain('CORS_ORIGINS');
      expect(collectEnvProblems(completeProdEnv())).toEqual([]);
    });

    it('warns that an SOS reaches nobody when no webhook is configured', () => {
      expect(collectEnvWarnings(completeProdEnv()).join()).toContain(
        'EMERGENCY_WEBHOOK_URLS',
      );
    });

    it('warns when Privy is half-configured', () => {
      const env = completeProdEnv();
      env.PRIVY_APP_ID = 'app-id';
      expect(collectEnvWarnings(env).join()).toContain('PRIVY');
    });

    it('stays quiet when everything optional is configured', () => {
      const env = completeProdEnv();
      env.CORS_ORIGINS = 'https://arkrides.com';
      env.EMERGENCY_WEBHOOK_URLS = 'https://ops.example/sos';
      env.PRIVY_APP_ID = 'app-id';
      env.PRIVY_VERIFICATION_KEY = 'key';
      expect(collectEnvWarnings(env)).toEqual([]);
    });

    it('reports only feature-gating gaps in development', () => {
      const warnings = collectEnvWarnings({ NODE_ENV: 'development' });

      // A bare development environment still has no SendGrid and no internal
      // key, and saying so is the point — those are the two features that will
      // silently not work. Nothing else should be reported.
      expect(warnings.join()).toContain('SENDGRID_API_KEY');
      expect(warnings.join()).toContain('INTERNAL_API_KEY');
      expect(warnings.join()).not.toContain('CORS_ORIGINS');
    });

    it('says nothing once everything is configured', () => {
      expect(
        collectEnvWarnings({
          ...completeProdEnv(),
          CORS_ORIGINS: 'https://arkrides.com',
          EMERGENCY_WEBHOOK_URLS: 'https://hooks.example/sos',
          PRIVY_APP_ID: 'app',
          PRIVY_VERIFICATION_KEY: 'key',
        }),
      ).toEqual([]);
    });
  });
});
