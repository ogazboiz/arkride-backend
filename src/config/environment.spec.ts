import {
  isDevelopment,
  isTest,
  isDevLike,
  isProductionLike,
} from './environment';

/**
 * The one property that matters here: an UNSET NODE_ENV must be treated as
 * production, not as development. Four call sites used to do the opposite, and
 * `compose.yml` sets nothing — so a production container inheriting no
 * NODE_ENV served Swagger publicly, allowlisted localhost for CORS, skipped
 * every production env check, and honoured DB_SYNCHRONIZE.
 */
describe('environment discriminator', () => {
  it('treats an UNSET NODE_ENV as production, not development', () => {
    expect(isDevelopment({})).toBe(false);
    expect(isDevLike({})).toBe(false);
    expect(isProductionLike({})).toBe(true);
  });

  it.each(['prod', 'PRODUCTION', 'Development', 'dev', '', ' development'])(
    'treats the near-miss value %p as production',
    (value) => {
      expect(isDevelopment({ NODE_ENV: value })).toBe(false);
      expect(isProductionLike({ NODE_ENV: value })).toBe(true);
    },
  );

  it('recognises development exactly', () => {
    expect(isDevelopment({ NODE_ENV: 'development' })).toBe(true);
    expect(isDevLike({ NODE_ENV: 'development' })).toBe(true);
    expect(isProductionLike({ NODE_ENV: 'development' })).toBe(false);
  });

  it('recognises test exactly', () => {
    expect(isTest({ NODE_ENV: 'test' })).toBe(true);
    expect(isDevelopment({ NODE_ENV: 'test' })).toBe(false);
    expect(isDevLike({ NODE_ENV: 'test' })).toBe(true);
  });

  it.each(['production', 'staging'])(
    'treats %p as production-like',
    (value) => {
      expect(isProductionLike({ NODE_ENV: value })).toBe(true);
      expect(isDevLike({ NODE_ENV: value })).toBe(false);
    },
  );
});
