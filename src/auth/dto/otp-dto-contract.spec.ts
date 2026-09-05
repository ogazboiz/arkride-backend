import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { VerifyOtpDto } from './verify-otp.dto';
import { ResetPasswordDto } from './reset-password.dto';
import { DriverResetPasswordDto } from '../../drivers/dto/reset-password.dto';
import { OtpUtil } from '../../common/utils/otp.util';

/**
 * The generator and the validators must agree.
 *
 * They did not. `OtpUtil.generate()` was widened from four digits to six for
 * the entropy, and every OTP DTO kept `@Length(4, 4)` — so `verify-otp`,
 * `/auth/reset-password` and `/drivers/reset-password` returned 400 for every
 * genuine code, and rider AND driver password reset were dead.
 *
 * Nothing caught it because the OtpUtil unit test pinned LENGTH === 6 and no
 * test touched the DTOs at all. This closes the loop: the assertion is that a
 * REAL generated code validates, so widening or narrowing the generator again
 * fails here rather than in production.
 */
const DTOS: Array<[string, new () => object, Record<string, unknown>]> = [
  ['VerifyOtpDto', VerifyOtpDto, { email: 'rider@example.com' }],
  [
    'ResetPasswordDto',
    ResetPasswordDto,
    { email: 'rider@example.com', newPassword: 'NewStrongPassword123!' },
  ],
  [
    'DriverResetPasswordDto',
    DriverResetPasswordDto,
    { email: 'driver@example.com', newPassword: 'NewStrongPassword123!' },
  ],
];

async function otpErrors(
  Dto: new () => object,
  base: Record<string, unknown>,
  otp: unknown,
): Promise<string[]> {
  const instance = plainToInstance(Dto, { ...base, otp });
  const errors = await validate(instance);
  return errors
    .filter((e) => e.property === 'otp')
    .flatMap((e) => Object.values(e.constraints ?? {}));
}

describe.each(DTOS)('%s otp field', (_name, Dto, base) => {
  it('accepts a code the generator actually produces', async () => {
    for (let i = 0; i < 25; i += 1) {
      expect(await otpErrors(Dto, base, OtpUtil.generate())).toEqual([]);
    }
  });

  it('rejects the old four-digit shape', async () => {
    expect((await otpErrors(Dto, base, '1234')).length).toBeGreaterThan(0);
  });

  it('rejects a code one digit too long', async () => {
    const tooLong = '1'.repeat(OtpUtil.LENGTH + 1);
    expect((await otpErrors(Dto, base, tooLong)).length).toBeGreaterThan(0);
  });

  it('rejects non-digits of the right length', async () => {
    // OtpUtil.matches pads into a fixed 64-byte buffer; a multi-byte character
    // can overflow it and make timingSafeEqual throw, which the filter would
    // turn into a 500. The DTO is what keeps that unreachable.
    const letters = 'a'.repeat(OtpUtil.LENGTH);
    expect((await otpErrors(Dto, base, letters)).length).toBeGreaterThan(0);

    const emoji = '🙂'.repeat(OtpUtil.LENGTH);
    expect((await otpErrors(Dto, base, emoji)).length).toBeGreaterThan(0);
  });

  it('rejects a missing code', async () => {
    expect((await otpErrors(Dto, base, undefined)).length).toBeGreaterThan(0);
  });
});
