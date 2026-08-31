import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  IsDateString,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateDriverDto {
  @ApiProperty({ example: 'Amina Yusuf' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: '+2348012345678', description: 'Valid Nigerian phone number' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^(\+234|0)[789]\d{9}$/, {
    message: 'Phone number must be a valid Nigerian phone number',
  })
  phone: string;

  @ApiProperty({ example: 'amina.driver@example.com' })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SecurePass123', minLength: 8 })
  @IsNotEmpty()
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password: string;

  @ApiProperty({ example: 'LAG-DRV-2025-001' })
  @IsNotEmpty()
  @IsString()
  licenseNumber: string;

  @ApiProperty({ example: '2028-12-31', description: 'ISO date string' })
  @IsNotEmpty()
  @IsDateString()
  licenseExpiry: string;

  @ApiProperty({ example: 'keke', enum: ['keke', 'bike', 'car', 'courier'] })
  @IsNotEmpty()
  @IsString()
  vehicleType: string;

  @ApiProperty({ example: 'ABC-123XY' })
  @IsNotEmpty()
  @IsString()
  plateNumber: string;

  @ApiProperty({ example: 'Yellow' })
  @IsNotEmpty()
  @IsString()
  vehicleColor: string;

  @ApiProperty({ example: 'Bajaj RE' })
  @IsNotEmpty()
  @IsString()
  vehicleModel: string;

  @ApiProperty({ example: 2024 })
  @IsNotEmpty()
  vehicleYear: number;
}
