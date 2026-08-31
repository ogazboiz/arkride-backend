import { IsEmail } from 'class-validator';

/**
 * DriverForgotPasswordDto
 * 
 * Purpose: Validate email when driver requests password reset
 * 
 * Used in: POST /api/v1/drivers/forgot-password
 * 
 * Example Request Body:
 * {
 *   "email": "driver@example.com"
 * }
 */
export class DriverForgotPasswordDto {
  /**
   * Driver's email address
   * 
   * Validation:
   * - Must be a valid email format
   * - Must match an existing driver account
   */
  @IsEmail()
  email: string;
}
