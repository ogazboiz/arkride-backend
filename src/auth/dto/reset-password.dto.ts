import { IsEmail, IsString, MinLength, Length, Matches } from 'class-validator';
import { OtpUtil } from '../../common/utils/otp.util';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123456', minLength: OtpUtil.LENGTH, maxLength: OtpUtil.LENGTH })
  @IsString()
  // Length AND alphabet come from OtpUtil, so the validator and the generator
  // cannot drift apart again. They already had: the generator was widened from
  // four digits to six for the entropy, and these DTOs kept `@Length(4, 4)` —
  // which rejected every genuine code and killed verify-otp and password reset
  // outright.
  //
  // The digits-only rule matters separately: OtpUtil.matches pads to a fixed
  // 64-byte buffer, and a multi-byte character can exceed that, so a non-ASCII
  // submission would otherwise reach timingSafeEqual with mismatched lengths.
  @Length(OtpUtil.LENGTH, OtpUtil.LENGTH, {
    message: `OTP must be exactly ${OtpUtil.LENGTH} digits`,
  })
  @Matches(/^[0-9]+$/, { message: 'OTP must contain only digits' })
  otp: string;

  @ApiProperty({ example: 'newStrongPassword123' })
  @IsString()
  newPassword: string;
}