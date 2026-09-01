import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DecaneAuthDto {
  @ApiProperty({
    description: 'Decane Access Token (ES256-signed JWT) obtained from client SDK',
    example: 'eyJhbGciOiJFUzI1NiIsImtpZCI6Ii4uLiJ9...',
  })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiPropertyOptional({
    description: 'Optional user full name override',
    example: 'John Doe',
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({
    description: 'Optional user email override',
    example: 'user@example.com',
  })
  @IsString()
  @IsOptional()
  email?: string;
}
