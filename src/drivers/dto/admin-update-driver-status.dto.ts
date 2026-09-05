import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VerificationStatus } from '../entities/driver.entity';

/**
 * Admin-only changes to a driver's standing on the platform.
 *
 * `PATCH /drivers/:id/verification-status` previously read
 * `@Body('status') status: VerificationStatus` with NO validation at all —
 * class-validator never sees a `@Body('key')` parameter, so any string went
 * straight into the enum column. `{"status":"whatever"}` was accepted and
 * wrote a value the enum does not contain.
 */
export class UpdateVerificationStatusDto {
  @ApiProperty({
    enum: VerificationStatus,
    example: VerificationStatus.APPROVED,
  })
  @IsEnum(VerificationStatus, {
    message: `status must be one of: ${Object.values(VerificationStatus).join(', ')}`,
  })
  status!: VerificationStatus;

  @ApiPropertyOptional({
    example: 'Licence photo unreadable',
    description: 'Shown to the driver when the application is rejected.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** Admin suspension / reinstatement. */
export class UpdateDriverActiveStatusDto {
  @ApiProperty({ example: false })
  @IsBoolean()
  isActive!: boolean;

  @ApiPropertyOptional({ example: 'Repeated no-shows' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
