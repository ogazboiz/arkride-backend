import { parseRedisUrl, redisConnectionUrl, redisConnection } from './redis.config';

/** A ConfigService stand-in — the real one only needs `get` here. */
const cfg = (env: Record<string, string | undefined>) =>
  ({ get: (k: string) => env[k] }) as never;

describe('redis configuration', () => {
  describe('parseRedisUrl', () => {
    it('parses the URL shape Railway and Heroku inject', () => {
      expect(
        parseRedisUrl('redis://default:s3cr3t@viaduct.proxy.rlwy.net:34567'),
      ).toEqual({
        host: 'viaduct.proxy.rlwy.net',
        port: 34567,
        password: 's3cr3t',
        username: 'default',
        tls: false,
      });
    });

    it('recognises rediss:// as TLS', () => {
      expect(parseRedisUrl('rediss://:pw@upstash.io:6380')?.tls).toBe(true);
    });

    it('defaults the port when the URL omits it', () => {
      expect(parseRedisUrl('redis://localhost')?.port).toBe(6379);
    });

    it('decodes a percent-encoded password', () => {
      // Managed providers generate passwords containing @ / : and friends.
      expect(parseRedisUrl('redis://:p%40ss%2Fword@host:6379')?.password).toBe(
        'p@ss/word',
      );
    });

    it('returns null for junk rather than throwing', () => {
      // A typo must fall back to the discrete variables, not crash the boot.
      expect(parseRedisUrl('not-a-url')).toBeNull();
      expect(parseRedisUrl('http://example.com')).toBeNull();
      expect(parseRedisUrl(undefined)).toBeNull();
    });
  });

  describe('redisConnection', () => {
    it('prefers REDIS_URL over the discrete parts', () => {
      // A platform that injects a URL is the authority on its own Redis.
      const conn = redisConnection(
        cfg({
          REDIS_URL: 'redis://:pw@managed:7000',
          REDIS_HOST: 'stale-leftover',
          REDIS_PORT: '6379',
        }),
      );
      expect(conn.host).toBe('managed');
      expect(conn.port).toBe(7000);
    });

    it('falls back to the discrete parts', () => {
      expect(
        redisConnection(cfg({ REDIS_HOST: 'redis', REDIS_PORT: '6380' })),
      ).toEqual({ host: 'redis', port: 6380, password: undefined, tls: false });
    });
  });

  describe('redisConnectionUrl', () => {
    it('includes the password', () => {
      // The previous implementation built redis://host:port with no
      // credentials, so it could only reach an unauthenticated Redis.
      expect(
        redisConnectionUrl(
          cfg({ REDIS_HOST: 'h', REDIS_PORT: '6379', REDIS_PASSWORD: 'pw' }),
        ),
      ).toBe('redis://:pw@h:6379');
    });

    it('percent-encodes a password with URL-significant characters', () => {
      expect(
        redisConnectionUrl(
          cfg({ REDIS_HOST: 'h', REDIS_PORT: '6379', REDIS_PASSWORD: 'p@ss/w' }),
        ),
      ).toBe('redis://:p%40ss%2Fw@h:6379');
    });

    it('passes an explicit REDIS_URL straight through', () => {
      const url = 'redis://default:pw@host:1234';
      expect(redisConnectionUrl(cfg({ REDIS_URL: url }))).toBe(url);
    });
  });
});
