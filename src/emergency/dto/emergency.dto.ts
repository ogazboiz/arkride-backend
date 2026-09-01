import {
  IsNotEmpty,
  IsUUID,
  IsOptional,
  IsNumber,
  IsString,
  IsEnum,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EmergencyStatus } from '../entities/emergency-incident.entity';

/**
 * DTO for raising an in-ride SOS
 */
export class TriggerEmergencyDto {
  @ApiProperty({ example: '123e4567-e89b-42d3-a456-426614174000' })
  @IsNotEmpty({ message: 'Ride ID is required' })
  @IsUUID('4', { message: 'Ride ID must be a valid UUID' })
  rideId: string;

  /**
   * Optional device coordinates. When absent the server falls back to the
   * driver's last GPS ping — the phone raising the alarm may have no fix.
   */
  @ApiPropertyOptional({ example: 6.6018 })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ example: 3.3515 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @ApiPropertyOptional({ example: 'Driver took an unfamiliar turn' })
  @IsOptional()
  @IsString()
  note?: string;
}

/**
 * DTO for an operator closing out an incident
 */
export class ResolveEmergencyDto {
  @ApiPropertyOptional({
    enum: [EmergencyStatus.RESOLVED, EmergencyStatus.FALSE_ALARM],
    example: EmergencyStatus.RESOLVED,
  })
  @IsOptional()
  @IsEnum(EmergencyStatus, {
    message: 'Status must be one of: resolved, false_alarm',
  })
  status?: EmergencyStatus;

  @ApiPropertyOptional({ example: 'Contacted both parties, rider is safe' })
  @IsOptional()
  @IsString()
  resolutionNote?: string;
}
