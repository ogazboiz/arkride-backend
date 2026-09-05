import { Logger } from '@nestjs/common';

/**
 * Fail-fast environment validation.
 *
 * WHY THIS EXISTS
 *
 * Four call sites used to read `JWT_SECRET` as
 * `config.get('JWT_SECRET') || 'your-secret-key'`. With the variable unset the
 * app booted happily and every token signed with that public string — a string
 * committed to a repo — was accepted, including one carrying `role: 'admin'`.
 * A missing secret is not a condition to paper over with a default; it is a
 * reason to refuse to start.
 *
 * The same reasoning applies to the database and Redis: a service that starts
 * without them only fails later, on a user's request, somewhere less obvious.
 *
 * Rules encoded here:
 *  - REQUIRED_ALWAYS      -> absent means the process exits, in every env.
 *  - REQUIRED_IN_PROD     -> absent is fatal outside development/test, and a
 *                            loud warning during local development so that a
 *                            laptop still runs without a SendGrid key.
 *  - FORBIDDEN_VALUES     -> present but set to a known placeholder is treated
 *                            exactly like absent. Shipping the example file's
 *                            value is the same mistake as shipping no value.
 */

/** Secrets that must never survive a copy of `.env.example` into `.env`. */
const PLACEHOLDER_VALUES = new Set([
  'your-secret-key',
  'change-me',
  'changeme',
  'replace-me',
  'secret',
  'password',
  'todo',
  '',
]);

/** Minimum entropy we will accept for a symmetric signing key. */
const MIN_SECRET_LENGTH = 32;

interface EnvRule {
  /** Variable name. */
  key: string;
  /** Fatal everywhere, or only outside local development. */
  scope: 'always' | 'production';
  /** Reject short values — only meaningful for signing keys. */
  minLength?: number;
  /** One line explaining what breaks without it, shown in the error. */
  because: string;
}

/** The only values NODE_ENV may take. Anything else is a typo. */
export const VALID_NODE_ENVS = ['development', 'test', 'staging', 'production'];

const RULES: EnvRule[] = [
  {
    key: 'NODE_ENV',
    scope: 'always',
    because:
      'it decides whether Swagger is exposed, whether CORS falls back to ' +
      'localhost, and whether the production-only variables below are ' +
      'enforced — every one of which fails OPEN when it is unset',
  },
  {
    key: 'JWT_SECRET',
    scope: 'always',
    minLength: MIN_SECRET_LENGTH,
    because:
      'every access token is signed and verified with it; without it the app would fall back to a public string and accept forged admin tokens',
  },
  {
    key: 'REDIS_HOST',
    scope: 'production',
    because:
      'ride locking, driver geo lookups, rate limiting and the job queues all live in Redis',
  },
];

/**
 * WHY SENDGRID AND INTERNAL_API_KEY ARE WARNINGS, NOT BLOCKERS
 *
 * They used to be blocking production rules, which meant a deployment with no
 * SendGrid account could not start at all. That was the wrong severity: each
 * of them gates exactly ONE feature, and the other ninety-odd endpoints —
 * sign-in, booking, the whole ride lifecycle, driver payouts, the admin
 * queue — work perfectly without them.
 *
 * Blocking on a missing SendGrid key treated "password reset cannot deliver
 * its email" as equivalent to "there is no database", and it stopped a
 * working product from shipping. What genuinely cannot be defaulted stays a
 * blocker: NODE_ENV and JWT_SECRET are security decisions, Redis carries ride
 * locking and rate limiting, and there is no app at all without a database.
 *
 * The consequences are stated at boot instead, loudly, every time.
 */

/**
 * A value counts as missing when it is absent, blank, or a known placeholder.
 * Case-insensitive: `Change-Me` is the same mistake as `change-me`.
 */
function isMissing(value: string | undefined): boolean {
  if (value === undefined) return true;
  return PLACEHOLDER_VALUES.has(value.trim().toLowerCase());
}

/**
 * Validate `env` and return the problems as human sentences.
 *
 * Pure and exported so the unit test can drive it without mutating
 * `process.env` or bootstrapping Nest.
 */
export function collectEnvProblems(env: NodeJS.ProcessEnv): string[] {
  // NOT `?? 'development'`. Defaulting an unset NODE_ENV to development is
  // fail-OPEN: `compose.yml` does not set it, so a production container that
  // inherited nothing would skip every production rule, mount Swagger
  // unauthenticated, and allowlist localhost as a CORS origin. Unset is a
  // problem to report, not a mode to assume.
  const nodeEnv = env.NODE_ENV;
  const isDevLike = nodeEnv === 'development' || nodeEnv === 'test';
  const problems: string[] = [];

  // A typo here is worse than an omission: `NODE_ENV=prod` is not
  // 'production', so every production-only rule below would be skipped and
  // Swagger would be served publicly, all without a single error.
  if (env.NODE_ENV !== undefined && !VALID_NODE_ENVS.includes(env.NODE_ENV)) {
    problems.push(
      `NODE_ENV is "${env.NODE_ENV}", which is not one of ` +
        `${VALID_NODE_ENVS.join(', ')} — anything else silently disables the ` +
        `production safety checks.`,
    );
  }

  for (const rule of RULES) {
    const enforced = rule.scope === 'always' || !isDevLike;
    if (!enforced) continue;

    const value = env[rule.key];

    if (isMissing(value)) {
      problems.push(
        `${rule.key} is not set (or is still a placeholder) — ${rule.because}.`,
      );
      continue;
    }

    if (rule.minLength && (value as string).length < rule.minLength) {
      problems.push(
        `${rule.key} is only ${(value as string).length} characters; at least ${rule.minLength} are required — ${rule.because}.`,
      );
    }
  }

  // The database is reachable either by URL or by discrete parts. Requiring
  // both would break the Docker compose setup, which uses the parts; requiring
  // neither is how you get a container that starts and then 500s.
  if (
    !isDevLike &&
    isMissing(env.DATABASE_URL) &&
    isMissing(env.DATABASE_HOST)
  ) {
    problems.push(
      'Neither DATABASE_URL nor DATABASE_HOST is set — there is no database to connect to.',
    );
  }

  return problems;
}

/**
 * Warnings are things that are legal but almost certainly unintended.
 * They never stop the process; they just refuse to be quiet.
 */
export function collectEnvWarnings(env: NodeJS.ProcessEnv): string[] {
  const warnings: string[] = [];

  // Feature-gating variables: absent means one feature is off, not that the
  // app is broken. Reported every boot so it is never a silent surprise.
  if (isMissing(env.SENDGRID_API_KEY) || isMissing(env.SENDGRID_FROM_EMAIL)) {
    warnings.push(
      'SENDGRID_API_KEY / SENDGRID_FROM_EMAIL are not both set — no email is ' +
        'sent, so password-reset and resend-OTP cannot deliver their codes. ' +
        'Everything else, including sign-up and sign-in, works normally.',
    );
  }

  if (isMissing(env.INTERNAL_API_KEY)) {
    warnings.push(
      'INTERNAL_API_KEY is not set — the booking-channels ingress ' +
        '(WhatsApp/voice) fails closed, so off-app booking is unavailable. ' +
        'In-app booking is unaffected.',
    );
  }
  // Not `?? 'development'`. Warnings are advisory, but defaulting here would
  // silence them for exactly the deployment that most needs them — one that
  // inherited no NODE_ENV at all.
  const nodeEnv = env.NODE_ENV;

  if (nodeEnv !== 'development' && nodeEnv !== 'test') {
    if (isMissing(env.CORS_ORIGINS)) {
      warnings.push(
        'CORS_ORIGINS is not set, so browser cross-origin requests will be refused. Set it to the comma-separated list of front-end origins.',
      );
    }
    if (isMissing(env.EMERGENCY_WEBHOOK_URLS)) {
      warnings.push(
        'EMERGENCY_WEBHOOK_URLS is not set — an SOS will be recorded and broadcast in-app, but no external party is notified.',
      );
    }
    if (isMissing(env.PRIVY_APP_ID) || isMissing(env.PRIVY_VERIFICATION_KEY)) {
      warnings.push(
        'PRIVY_APP_ID / PRIVY_VERIFICATION_KEY are not both set — Privy sign-in is disabled and only email/password login will work.',
      );
    }
  }

  return warnings;
}

/**
 * Called from `bootstrap()` before the Nest app is created.
 *
 * Throws rather than calling `process.exit`, so a test can assert on it and so
 * the stack trace still reaches whatever supervises the process.
 */
export function validateEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const logger = new Logger('EnvValidation');
  const problems = collectEnvProblems(env);

  for (const warning of collectEnvWarnings(env)) {
    logger.warn(warning);
  }

  if (problems.length === 0) return;

  const detail = problems.map((p) => `  - ${p}`).join('\n');
  throw new Error(
    `Refusing to start: the environment is incomplete.\n${detail}\n` +
      `See .env.example for the full list of variables.`,
  );
}
