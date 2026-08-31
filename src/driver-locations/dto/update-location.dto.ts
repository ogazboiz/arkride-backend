import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min, Max } from 'class-validator';

/**
 * UpdateLocationDto
 * 
 * Purpose: Validate GPS coordinates when driver updates their location
 * 
 * Used in: POST /api/v1/driver-locations
 * 
 * Example Request Body:
 * {
 *   "latitude": 6.5244,
 *   "longitude": 3.3792
 * }
 * 
 * Security Note:
 * The driver ID is automatically extracted from the JWT token,
 * ensuring drivers can only update their own location.
 */
export class UpdateLocationDto {

  /**
   * Latitude (North-South position on Earth)
   * 
   * Valid Range: -90 to +90
   * - +90 = North Pole
   * - 0 = Equator
   * - -90 = South Pole
   * 
   * Nigeria Example:
   * - Lagos: 6.5244 (North of Equator)
   * - Abuja: 9.0579 (North of Equator)
   * 
   * Validation:
   * - Must be a number
   * - Must be >= -90
   * - Must be <= +90
   */
  @ApiProperty({ example: 6.5244, minimum: -90, maximum: 90 })
  @IsNumber()
  @Min(-90, { message: 'Latitude must be between -90 and 90' })
  @Max(90, { message: 'Latitude must be between -90 and 90' })
  latitude!: number;

  /**
   * Longitude (East-West position on Earth)
   * 
   * Valid Range: -180 to +180
   * - +180 = International Date Line (East)
   * - 0 = Prime Meridian (Greenwich, UK)
   * - -180 = International Date Line (West)
   * 
   * Nigeria Example:
   * - Lagos: 3.3792 (East of Prime Meridian)
   * - Abuja: 7.4951 (East of Prime Meridian)
   * 
   * Validation:
   * - Must be a number
   * - Must be >= -180
   * - Must be <= +180
   */
  @ApiProperty({ example: 3.3792, minimum: -180, maximum: 180 })
  @IsNumber()
  @Min(-180, { message: 'Longitude must be between -180 and 180' })
  @Max(180, { message: 'Longitude must be between -180 and 180' })
  longitude!: number;
}
