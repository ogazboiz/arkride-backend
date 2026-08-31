import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DriverLoginDto {
  @ApiProperty({ example: 'amina.driver@example.com' })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SecurePass123' })
  @IsNotEmpty()
  @IsString()
  password: string;
}
