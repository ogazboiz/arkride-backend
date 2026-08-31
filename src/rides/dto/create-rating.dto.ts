import { IsUUID, IsInt, Min, Max, IsString, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRatingDto {
  @ApiProperty({ description: 'The UUID of the ride' })
  @IsUUID()
  rideId: string;

  @ApiProperty({ description: 'The UUID of the person being rated' })
  @IsUUID()
  rateeId: string;

  @ApiProperty({ description: 'The type of the person being rated', enum: ['user', 'driver'] })
  @IsEnum(['user', 'driver'])
  rateeType: 'user' | 'driver';

  @ApiProperty({ description: 'Rating from 1 to 5', minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiProperty({ description: 'Optional comment', required: false })
  @IsString()
  @IsOptional()
  comment?: string;
}
