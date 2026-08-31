import { IsEmail, IsString, Length } from 'class-validator';

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
 *   "otp": "1234",
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
   * - Must be exactly 4 digits
   * - Must match the OTP stored in database
   * - Must not be expired (10 minutes validity)
   */
  @IsString()
  @Length(4, 4, { message: 'OTP must be exactly 4 digits' })
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
