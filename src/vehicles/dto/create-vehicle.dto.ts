import {
  IsEnum,
  IsNotEmpty,
  IsString,
  IsInt,
  Min,
  Max,
  IsUUID,
  IsOptional,
  Matches,
} from 'class-validator';
import { VehicleType } from '../entities/vehicle.entity';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export class CreateVehicleDto {
  /**
   * Whose vehicle this is.
   *
   * SECURITY: this used to be REQUIRED and taken at face value on an endpoint
   * guarded only by JwtAuthGuard, so any authenticated rider could register a
   * vehicle against any driver's id.
   *
   * It is now optional and ADMIN-ONLY: a driver's own id is taken from their
   * access token and a driver supplying this field is rejected outright rather
   * than silently ignored, so a client that thinks it is setting the owner
   * finds out that it is not.
   */
  @ApiPropertyOptional({
    example: '123e4567-e89b-42d3-a456-426614174000',
    description:
      'Admin only. Drivers must omit this — the owner is taken from the access token.',
  })
  @IsOptional()
  @IsUUID()
  driverId?: string;

  @ApiProperty({ enum: VehicleType, example: VehicleType.KEKE })
  @IsNotEmpty()
  @IsEnum(VehicleType, {
    message: 'Vehicle type must be one of: keke, bike, car, courier',
  })
  type: VehicleType;

  @ApiProperty({ example: 'ABC-123XY' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^[A-Z0-9-]+$/, {
    message: 'Plate number must contain only uppercase letters, numbers, and hyphens',
  })
  plateNumber: string;

  @ApiProperty({ example: 'Yellow' })
  @IsNotEmpty()
  @IsString()
  color: string;

  @ApiProperty({ example: 'Bajaj RE' })
  @IsNotEmpty()
  @IsString()
  model: string;

  @ApiProperty({ example: 2024, minimum: 1990 })
  @IsNotEmpty()
  @IsInt()
  @Min(1990, { message: 'Year must be 1990 or later' })
  @Max(new Date().getFullYear() + 1, { message: 'Year cannot be more than next year' })
  year: number;
}
