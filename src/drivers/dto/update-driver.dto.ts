import {
  IsEmail,
  IsString,
  MinLength,
  IsDateString,
  Matches,
  IsBoolean,
  IsEnum,
  IsOptional,
} from 'class-validator';
import { VerificationStatus } from '../entities/driver.entity';
import { PartialType } from '@nestjs/mapped-types';
import { CreateDriverDto } from './create-driver.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDriverDto extends PartialType(CreateDriverDto) {
  @ApiPropertyOptional({ example: 'Amina Yusuf' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'amina.driver@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '08012345678' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{10,15}$/, { message: 'Phone number must be 10-15 digits' })
  phone?: string;

  @ApiPropertyOptional({ example: 'SecurePass123' })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional({ example: 'LAG-DRV-2025-001' })
  @IsOptional()
  @IsString()
  licenseNumber?: string;

  @ApiPropertyOptional({ example: '2028-12-31' })
  @IsOptional()
  @IsString()
  licenseExpiry?: string;

  @ApiPropertyOptional({ example: 'keke' })
  @IsOptional()
  @IsString()
  vehicleType?: string;

  @ApiPropertyOptional({ example: 'ABC-123XY' })
  @IsOptional()
  @IsString()
  vehiclePlateNumber?: string;

  @ApiPropertyOptional({ enum: VerificationStatus, example: VerificationStatus.APPROVED })
  @IsOptional()
  @IsEnum(VerificationStatus)
  verificationStatus?: VerificationStatus;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isOnline?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
