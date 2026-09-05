import { OtpUtil } from './otp.util';

describe('OtpUtil', () => {
  describe('generate', () => {
    it('always produces exactly LENGTH digits', () => {
      for (let i = 0; i < 500; i += 1) {
        const code = OtpUtil.generate();
        expect(code).toHaveLength(OtpUtil.LENGTH);
        expect(code).toMatch(/^\d+$/);
      }
    });

    it('uses a six-digit space, not the old four-digit one', () => {
      // 4 digits is 9,000 values — brute-forceable by hand inside the
      // ten-minute validity window.
      expect(OtpUtil.LENGTH).toBe(6);
    });

    it('never starts with a zero, so the string length is stable', () => {
      for (let i = 0; i < 500; i += 1) {
        expect(OtpUtil.generate().startsWith('0')).toBe(false);
      }
    });

    it('does not repeat itself over many draws', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 2000; i += 1) seen.add(OtpUtil.generate());
      // With 900k values, 2000 draws should give near-2000 distinct codes.
      expect(seen.size).toBeGreaterThan(1900);
    });

    it('spreads across the range rather than clustering', () => {
      // A modulus-based generator biases low. randomInt rejection-samples.
      const buckets = new Array(9).fill(0);
      for (let i = 0; i < 9000; i += 1) {
        buckets[Number(OtpUtil.generate()[0]) - 1] += 1;
      }
      for (const count of buckets) {
        expect(count).toBeGreaterThan(700);
        expect(count).toBeLessThan(1300);
      }
    });
  });

  describe('isExpired', () => {
    it('is false for a future expiry', () => {
      expect(OtpUtil.isExpired(new Date(Date.now() + 60_000))).toBe(false);
    });

    it('is true for a past expiry', () => {
      expect(OtpUtil.isExpired(new Date(Date.now() - 1))).toBe(true);
    });

    it('treats a null expiry as expired, never as valid-forever', () => {
      // A row with a code but no expiry must not be a permanent skeleton key.
      expect(OtpUtil.isExpired(null)).toBe(true);
      expect(OtpUtil.isExpired(undefined)).toBe(true);
    });

    it('accepts a date that arrived as a string from the driver', () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      expect(OtpUtil.isExpired(future as unknown as Date)).toBe(false);
    });
  });

  describe('getExpiryTime', () => {
    it('defaults to ten minutes out', () => {
      const delta = OtpUtil.getExpiryTime().getTime() - Date.now();
      expect(delta).toBeGreaterThan(9 * 60_000);
      expect(delta).toBeLessThanOrEqual(10 * 60_000 + 50);
    });

    it('honours an explicit window', () => {
      const delta = OtpUtil.getExpiryTime(2).getTime() - Date.now();
      expect(delta).toBeLessThanOrEqual(2 * 60_000 + 50);
    });
  });

  describe('matches', () => {
    it('accepts the right code', () => {
      expect(OtpUtil.matches('123456', '123456')).toBe(true);
    });

    it('rejects a wrong code', () => {
      expect(OtpUtil.matches('123456', '654321')).toBe(false);
    });

    it('rejects a correct prefix', () => {
      // The failure mode a non-constant-time compare enables.
      expect(OtpUtil.matches('12345', '123456')).toBe(false);
      expect(OtpUtil.matches('1234567', '123456')).toBe(false);
    });

    it.each([
      [null, '123456'],
      ['123456', null],
      [undefined, undefined],
      ['', '123456'],
      ['123456', ''],
    ])('rejects %p vs %p', (submitted, stored) => {
      expect(OtpUtil.matches(submitted as any, stored as any)).toBe(false);
    });

    it('does not throw on an absurdly long submission', () => {
      // timingSafeEqual throws on mismatched buffer lengths; the padding is
      // what stops that from becoming an observable difference (or a 500).
      expect(() => OtpUtil.matches('9'.repeat(10_000), '123456')).not.toThrow();
      expect(OtpUtil.matches('9'.repeat(10_000), '123456')).toBe(false);
    });
  });
});
