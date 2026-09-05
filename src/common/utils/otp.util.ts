import { randomInt, timingSafeEqual } from 'node:crypto';

/**
 * One-time codes for account verification and password reset.
 *
 * WHAT WAS WRONG
 *
 *  - `Math.floor(1000 + Math.random() * 9000)`. `Math.random()` is not a CSPRNG;
 *    V8's xorshift128+ state is recoverable from a handful of outputs, so an
 *    attacker who can trigger OTPs for their own account can predict the next
 *    one issued to somebody else's.
 *  - FOUR digits — a 9,000-value space. A password-reset code that small is
 *    guessable by hand inside the ten-minute window.
 *  - No attempt counter and no lockout, so nothing made guessing expensive.
 *
 * Now: `crypto.randomInt` (rejection-sampled, uniform), six digits, a constant
 * -time comparison, and an attempt budget the caller enforces per account.
 */
export class OtpUtil {
  /** Digits in a generated code. Six -> 900,000 values. */
  static readonly LENGTH = 6;

  /** Wrong guesses allowed against one issued code before it is burnt. */
  static readonly MAX_ATTEMPTS = 5;

  /**
   * A cryptographically random code.
   *
   * `randomInt(min, max)` is uniform over [min, max) — it rejection-samples
   * rather than taking a modulus, so low codes are not more likely than high
   * ones. Codes never start with 0, so the string is always LENGTH digits and
   * a client that parses it as a number cannot lose a leading zero.
   */
  static generate(): string {
    const min = 10 ** (OtpUtil.LENGTH - 1);
    const max = 10 ** OtpUtil.LENGTH;
    return randomInt(min, max).toString();
  }

  /** Expiry instant for a freshly issued code. */
  static getExpiryTime(minutes: number = 10): Date {
    return new Date(Date.now() + minutes * 60_000);
  }

  /** True when the code is past its expiry. A null expiry counts as expired. */
  static isExpired(expiryDate: Date | null | undefined): boolean {
    if (!expiryDate) return true;
    return new Date() > new Date(expiryDate);
  }

  /**
   * Compare a submitted code against the stored one without leaking timing.
   *
   * A plain `===` on strings short-circuits at the first differing byte, which
   * is measurable over enough requests and lets a code be recovered digit by
   * digit. Both sides are padded to equal length first because
   * `timingSafeEqual` throws — itself an observable difference — on a length
   * mismatch.
   */
  static matches(
    submitted: string | null | undefined,
    stored: string | null | undefined,
  ): boolean {
    if (!submitted || !stored) return false;

    const a = Buffer.from(submitted.padEnd(64, '\0').slice(0, 64), 'utf8');
    const b = Buffer.from(stored.padEnd(64, '\0').slice(0, 64), 'utf8');

    // The length check is folded into the compared bytes above, so this is a
    // single constant-time operation over a fixed width.
    return timingSafeEqual(a, b) && submitted.length === stored.length;
  }
}
