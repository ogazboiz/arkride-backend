import {
  clampLimit,
  clampOffset,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
} from './pagination.util';

describe('pagination clamps', () => {
  describe('clampLimit', () => {
    it('passes a sensible value through', () => {
      expect(clampLimit('25')).toBe(25);
      expect(clampLimit(25)).toBe(25);
    });

    it('falls back when absent', () => {
      expect(clampLimit(undefined)).toBe(DEFAULT_PAGE_LIMIT);
      expect(clampLimit(null)).toBe(DEFAULT_PAGE_LIMIT);
      expect(clampLimit('')).toBe(DEFAULT_PAGE_LIMIT);
    });

    it.each(['abc', 'NaN', '1e999', 'Infinity', '-Infinity'])(
      'falls back rather than producing NaN for %p',
      (value) => {
        // `Number('abc')` is NaN, which TypeORM passes to `take:` and Postgres
        // rejects — a 500 from a one-character typo in a query string.
        expect(Number.isFinite(clampLimit(value))).toBe(true);
      },
    );

    it.each(['0', '-1', '-999'])(
      'falls back for the non-positive %p',
      (value) => {
        expect(clampLimit(value)).toBe(DEFAULT_PAGE_LIMIT);
      },
    );

    it('caps an absurd request instead of honouring it', () => {
      // `?limit=999999999` used to be passed straight through.
      expect(clampLimit('999999999')).toBe(MAX_PAGE_LIMIT);
    });

    it('floors a fractional value', () => {
      expect(clampLimit('10.9')).toBe(10);
    });

    it('honours a caller-supplied cap', () => {
      expect(clampLimit('100', 10, 20)).toBe(20);
    });
  });

  describe('clampOffset', () => {
    it('passes a sensible value through', () => {
      expect(clampOffset('40')).toBe(40);
    });

    it.each([undefined, null, '', 'abc', '-5', 'Infinity'])(
      'returns 0 for %p',
      (value) => {
        expect(clampOffset(value as any)).toBe(0);
      },
    );

    it('floors a fractional value', () => {
      expect(clampOffset('10.9')).toBe(10);
    });
  });
});
