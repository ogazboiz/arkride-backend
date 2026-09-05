import { ConfigService } from '@nestjs/config';

/**
 * One place that decides how to reach Redis.
 *
 * TWO WAYS TO CONFIGURE IT, AND WHY BOTH EXIST
 *
 * Docker Compose and a local install give you discrete parts — host, port,
 * password. Managed platforms (Railway, Heroku, Upstash, Render) give you a
 * single connection URL and nothing else. Supporting only the parts means
 * hand-splitting a URL into three variables on every deploy, which is exactly
 * the kind of manual step that gets one field wrong and produces
 * "REDIS_HOST is not set" on a project where Redis is plainly running.
 *
 * REDIS_URL wins when both are present, because a platform that injects it is
 * the authority on where its own Redis lives.
 */
export interface RedisConnection {
  host: string;
  port: number;
  password?: string;
  username?: string;
  /** True when the URL asked for TLS (`rediss://`). */
  tls: boolean;
}

const DEFAULT_PORT = 6379;

/**
 * Parse a `redis://` or `rediss://` URL.
 *
 * Returns null rather than throwing on a malformed value, so a typo falls back
 * to the discrete variables instead of crashing the whole app at boot.
 */
export function parseRedisUrl(raw: string | undefined): RedisConnection | null {
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') return null;

    return {
      host: url.hostname,
      port: url.port ? parseInt(url.port, 10) : DEFAULT_PORT,
      // Redis URLs carry the password in the password field, and often a
      // meaningless "default" username that must still be sent.
      password: url.password ? decodeURIComponent(url.password) : undefined,
      username: url.username ? decodeURIComponent(url.username) : undefined,
      tls: url.protocol === 'rediss:',
    };
  } catch {
    return null;
  }
}

/** The connection to use, from whichever source is configured. */
export function redisConnection(config: ConfigService): RedisConnection {
  const fromUrl = parseRedisUrl(config.get<string>('REDIS_URL'));
  if (fromUrl) return fromUrl;

  return {
    host: config.get<string>('REDIS_HOST') || 'localhost',
    port: parseInt(String(config.get('REDIS_PORT') ?? DEFAULT_PORT), 10),
    password: config.get<string>('REDIS_PASSWORD') || undefined,
    tls: false,
  };
}

/**
 * The same connection as a URL, for libraries that only take one.
 *
 * The password is included and percent-encoded. The previous version built
 * `redis://${host}:${port}` with no credentials at all, which works against an
 * unauthenticated local Redis and fails against every managed one — including
 * Railway's, which always requires auth.
 */
export function redisConnectionUrl(config: ConfigService): string {
  const explicit = config.get<string>('REDIS_URL');
  if (parseRedisUrl(explicit)) return explicit as string;

  const { host, port, password, tls } = redisConnection(config);
  const scheme = tls ? 'rediss' : 'redis';
  const auth = password ? `:${encodeURIComponent(password)}@` : '';

  return `${scheme}://${auth}${host}:${port}`;
}
