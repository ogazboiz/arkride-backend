import { IsEmail, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyOtpDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '1234', minLength: 4, maxLength: 4 })
  @IsString()
  @Length(4, 4, { message: 'OTP must be exactly 4 digits' })
  otp: string;
}