import { IsEnum, IsNotEmpty, IsUUID } from 'class-validator';
import { RideStatus } from '../entities/ride.entity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for drivers to update ride status
 * Used for accepting, arriving, starting, and completing rides
 */
export class UpdateRideStatusDto {
  // The new status to set
  @ApiProperty({ enum: RideStatus, example: RideStatus.ACCEPTED })
  @IsNotEmpty({ message: 'Status is required' })
  @IsEnum(RideStatus, {
    message: 'Status must be one of: requested, accepted, arrived, in_progress, completed, cancelled',
  })
  status: RideStatus;

  // Vehicle ID when accepting a ride (required for 'accepted' status)
  @ApiPropertyOptional({ example: '123e4567-e89b-42d3-a456-426614174000' })
  @IsUUID('4', { message: 'Vehicle ID must be a valid UUID' })
  vehicleId?: string;
}
