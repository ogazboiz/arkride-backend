import {
  IsEnum,
  IsNotEmpty,
  IsString,
  IsInt,
  Min,
  Max,
  IsUUID,
  Matches,
} from 'class-validator';
import { VehicleType } from '../entities/vehicle.entity';
import { ApiProperty } from '@nestjs/swagger';

export class CreateVehicleDto {
  @ApiProperty({ example: '123e4567-e89b-42d3-a456-426614174000' })
  @IsNotEmpty()
  @IsUUID()
  driverId: string;

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
