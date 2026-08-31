import { IsString, Matches, IsEmail, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
    @ApiProperty({ example: 'John Doe' })
    @IsString()
    name: string;

    @ApiProperty({ example: 'john@example.com' })
    @IsEmail()
    email: string;

    @ApiProperty({ example: '08012345678', description: 'Phone number with 10-15 digits' })
    @IsString()
    @Matches(/^[0-9]{10,15}$/, { message: 'Phone number must be 10-15 digits' })
  phone: string;

    @ApiProperty({ example: 'strongpassword123' })
    @IsString()
    password: string;

    @ApiProperty({ example: 'strongpassword123' })
    @IsString()
    confirmPassword: string;

    @ApiProperty({ example: true })
    @IsBoolean()
    acceptTerms: boolean;
}