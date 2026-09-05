import {
  IsUUID,
  IsInt,
  Min,
  Max,
  IsString,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRatingDto {
  @ApiProperty({
    description: 'The UUID of the ride',
    example: '3f2a1c88-7b6d-4e21-9f0a-2c5d8e1b4a90',
  })
  @IsUUID()
  rideId: string;

  @ApiProperty({
    description: 'The UUID of the person being rated',
    example: 'b91e4d2f-0a35-4c77-8de1-6f9a3b2c5d84',
  })
  @IsUUID()
  rateeId: string;

  @ApiProperty({
    description: 'The type of the person being rated',
    enum: ['user', 'driver'],
    example: 'driver',
  })
  @IsEnum(['user', 'driver'])
  rateeType: 'user' | 'driver';

  @ApiProperty({
    description: 'Rating from 1 to 5',
    minimum: 1,
    maximum: 5,
    example: 5,
  })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiProperty({
    description: 'Optional comment',
    required: false,
    example: 'Smooth ride, arrived on time.',
  })
  @IsString()
  @IsOptional()
  comment?: string;
}
