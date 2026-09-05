import { parseOrigins, isOriginAllowed, corsOptions } from './cors.config';

describe('CORS policy', () => {
  describe('parseOrigins', () => {
    it('splits, trims and drops blanks', () => {
      expect(parseOrigins(' https://a.com , https://b.com ,, ')).toEqual([
        'https://a.com',
        'https://b.com',
      ]);
    });

    it('returns an empty list for an unset value', () => {
      expect(parseOrigins(undefined)).toEqual([]);
    });
  });

  describe('isOriginAllowed', () => {
    it('allows a listed origin', () => {
      expect(isOriginAllowed('https://a.com', ['https://a.com'], false)).toBe(true);
    });

    it('refuses an unlisted origin in production', () => {
      // app.enableCors() with no argument reflected this back. That is the bug.
      expect(isOriginAllowed('https://evil.com', ['https://a.com'], false)).toBe(
        false,
      );
    });

    it('refuses everything when the allowlist is empty in production', () => {
      expect(isOriginAllowed('https://a.com', [], false)).toBe(false);
    });

    it('allows a caller with no Origin header', () => {
      // curl, native mobile clients and server-to-server calls send none, and
      // they are not subject to the same-origin policy anyway.
      expect(isOriginAllowed(undefined, [], false)).toBe(true);
    });

    it('allows localhost during development only', () => {
      expect(isOriginAllowed('http://localhost:3000', [], true)).toBe(true);
      expect(isOriginAllowed('http://localhost:3000', [], false)).toBe(false);
    });

    it('does not treat a listed origin as a prefix', () => {
      // https://arkrides.com.evil.com must not match https://arkrides.com
      expect(
        isOriginAllowed('https://arkrides.com.evil.com', ['https://arkrides.com'], false),
      ).toBe(false);
    });
  });

  describe('corsOptions', () => {
    it('refuses an unlisted origin via the callback', (done) => {
      const options = corsOptions({ NODE_ENV: 'production', CORS_ORIGINS: 'https://a.com' });
      (options.origin as any)('https://evil.com', (err: unknown, allow: boolean) => {
        expect(err).toBeNull();
        expect(allow).toBe(false);
        done();
      });
    });

    it('allows a listed origin via the callback', (done) => {
      const options = corsOptions({ NODE_ENV: 'production', CORS_ORIGINS: 'https://a.com' });
      (options.origin as any)('https://a.com', (_err: unknown, allow: boolean) => {
        expect(allow).toBe(true);
        done();
      });
    });

    it('permits the headers Privy and internal callers actually send', () => {
      const options = corsOptions({ NODE_ENV: 'production' });
      expect(options.allowedHeaders).toEqual(
        expect.arrayContaining(['Authorization', 'privy-id-token', 'x-internal-api-key']),
      );
    });
  });
});
