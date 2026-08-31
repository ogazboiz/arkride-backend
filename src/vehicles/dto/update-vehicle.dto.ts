import {
  IsEnum,
  IsString,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsBoolean,
  Matches,
} from 'class-validator';
import { VehicleType } from '../entities/vehicle.entity';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateVehicleDto {
  @ApiPropertyOptional({ enum: VehicleType, example: VehicleType.KEKE })
  @IsOptional()
  @IsEnum(VehicleType, {
    message: 'Vehicle type must be one of: keke, bike, car, courier',
  })
  type?: VehicleType;

  @ApiPropertyOptional({ example: 'ABC-123XY' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9-]+$/, {
    message: 'Plate number must contain only uppercase letters, numbers, and hyphens',
  })
  plateNumber?: string;

  @ApiPropertyOptional({ example: 'Yellow' })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional({ example: 'Bajaj RE' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ example: 2024, minimum: 1990 })
  @IsOptional()
  @IsInt()
  @Min(1990, { message: 'Year must be 1990 or later' })
  @Max(new Date().getFullYear() + 1, { message: 'Year cannot be more than next year' })
  year?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
