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
 * Now: `crypto.randomInt` (rejection-sampled, uniform), six digits, and a
 * constant-time comparison. An attempt budget is defined below but is NOT yet
 * enforced — see MAX_ATTEMPTS for what actually bounds guessing today.
 */
export class OtpUtil {
  /** Digits in a generated code. Six -> 900,000 values. */
  static readonly LENGTH = 6;

  /**
   * Wrong guesses allowed against one issued code before it is burnt.
   *
   * NOT ENFORCED YET — deliberately left here, and deliberately said out loud.
   * Enforcing it needs an attempt counter on the users and drivers rows and a
   * migration to add it, which is a schema change this branch is not making.
   *
   * What currently bounds guessing is the throttler: credential endpoints are
   * clamped to 5 requests a minute per IP (SecurityModule), against a
   * six-digit space and a ten-minute validity window. That is a real bound,
   * but it is per IP rather than per account, so it does not stop a
   * distributed attempt.
   */
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

    // Pad the BYTES, not the characters.
    //
    // `str.padEnd(64).slice(0, 64)` counts UTF-16 code units, so a multi-byte
    // submission produces a buffer longer than 64 — and `timingSafeEqual`
    // THROWS on a length mismatch, which the exception filter would turn into
    // a 500. The DTO now constrains OTPs to digits, but this must not depend
    // on a validator somewhere else staying correct.
    const a = OtpUtil.fixedWidth(submitted);
    const b = OtpUtil.fixedWidth(stored);

    // Length is folded into the compared bytes, so this is one constant-time
    // operation over a fixed width; the explicit length check afterwards costs
    // nothing extra because both values are already known.
    return timingSafeEqual(a, b) && submitted.length === stored.length;
  }

  /** A 64-byte buffer holding (a truncation of) `value`, zero-padded. */
  private static fixedWidth(value: string): Buffer {
    const buffer = Buffer.alloc(64);
    // `write` truncates at the buffer's capacity and never overflows it, so an
    // arbitrarily long or multi-byte input is safe here.
    buffer.write(value, 'utf8');
    return buffer;
  }
}
