/**
 * What environment is this?
 *
 * WHY A HELPER RATHER THAN `process.env.NODE_ENV === 'development'` INLINE
 *
 * Four separate places asked that question, and every one of them wrote
 * `process.env.NODE_ENV ?? 'development'` — i.e. they all treated an UNSET
 * variable as development. `compose.yml` never sets NODE_ENV, so a production
 * container inheriting nothing would, all at once:
 *
 *   - serve Swagger publicly at /api,
 *   - allowlist http://localhost:3000 as a CORS origin with credentials,
 *   - skip every production-only environment check, and
 *   - honour DB_SYNCHRONIZE=true.
 *
 * Fail-open on the environment discriminator, four times over. Here it fails
 * CLOSED: anything that is not explicitly a development or test value is
 * treated as production. `validateEnvironment` separately refuses to start
 * when NODE_ENV is unset, so this is the second line of defence rather than
 * the only one.
 */

export function isDevelopment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'development';
}

export function isTest(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'test';
}

/** Development or test — the environments where convenience beats caution. */
export function isDevLike(env: NodeJS.ProcessEnv = process.env): boolean {
  return isDevelopment(env) || isTest(env);
}

/** Everything else, INCLUDING an unset NODE_ENV. */
export function isProductionLike(env: NodeJS.ProcessEnv = process.env): boolean {
  return !isDevLike(env);
}
