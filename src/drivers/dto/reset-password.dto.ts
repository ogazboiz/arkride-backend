import { IsEmail, IsString, Length, Matches } from 'class-validator';
import { OtpUtil } from '../../common/utils/otp.util';

/**
 * DriverResetPasswordDto
 * 
 * Purpose: Validate OTP and new password when driver resets password
 * 
 * Used in: POST /api/v1/drivers/reset-password
 * 
 * Example Request Body:
 * {
 *   "email": "driver@example.com",
 *   "otp": "123456",
 *   "newPassword": "NewSecurePassword123!"
 * }
 */
export class DriverResetPasswordDto {
  /**
   * Driver's email address
   * 
   * Validation:
   * - Must be a valid email format
   */
  @IsEmail()
  email: string;

  /**
   * One-Time Password sent to email
   * 
   * Validation:
   * - Must be exactly OtpUtil.LENGTH digits
   * - Must match the OTP stored in database
   * - Must not be expired (10 minutes validity)
   */
  @IsString()
  // Length AND alphabet come from OtpUtil, so the validator and the generator
  // cannot drift apart again. They already had: the generator was widened from
  // four digits to six for the entropy, and these DTOs kept `@Length(4, 4)` —
  // which rejected every genuine code and killed verify-otp and password reset
  // outright.
  //
  // The digits-only rule matters separately: OtpUtil.matches pads to a fixed
  // 64-byte buffer, and a multi-byte character can exceed that, so a non-ASCII
  // submission would otherwise reach timingSafeEqual with mismatched lengths.
  @Length(OtpUtil.LENGTH, OtpUtil.LENGTH, {
    message: `OTP must be exactly ${OtpUtil.LENGTH} digits`,
  })
  @Matches(/^[0-9]+$/, { message: 'OTP must contain only digits' })
  otp: string;

  /**
   * New password for the account
   * 
   * Validation:
   * - Must be a non-empty string
   * - Will be hashed before storing in database
   * 
   * Security:
   * - Password should meet minimum requirements (enforce in frontend)
   * - Old password is not required (passwordless reset via OTP)
   */
  @IsString()
  newPassword: string;
}
