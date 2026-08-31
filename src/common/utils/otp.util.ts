export class OtpUtil {
  /**
   * Generate a 4-digit OTP
   */
  static generate(): string {
    // Generates a number between 1000 and 9999
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  /**
   * Calculate OTP expiry time (default 10 minutes)
   */
  static getExpiryTime(minutes: number = 10): Date {
    return new Date(Date.now() + minutes * 60000);
  }

  /**
   * Check if OTP is expired
   */
  static isExpired(expiryDate: Date): boolean {
    return new Date() > expiryDate;
  }
}