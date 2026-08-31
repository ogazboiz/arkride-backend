import { IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for cancelling a ride
 * Can be used by both users and drivers
 */
export class CancelRideDto {
  // Optional reason for cancellation
  // Should be required for drivers, optional for users
  @ApiPropertyOptional({ example: 'Rider requested cancellation.' })
  @IsOptional()
  @IsString()
  cancellationReason?: string;
}
