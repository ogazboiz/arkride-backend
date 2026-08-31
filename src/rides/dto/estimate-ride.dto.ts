import { IsNotEmpty, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { LocationDto } from './create-ride.dto';
import { RideCategory } from '../entities/ride.entity';

/**
 * DTO for requesting ride price estimates
 */
export class EstimateRideDto {
  @ApiProperty({ 
    type: () => LocationDto,
    description: 'The pickup location coordinates and address'
  })
  @IsNotEmpty({ message: 'Pickup location is required' })
  @ValidateNested()
  @Type(() => LocationDto)
  pickup: LocationDto;

  @ApiProperty({ 
    type: () => LocationDto,
    description: 'The destination location coordinates and address'
  })
  @IsNotEmpty({ message: 'Dropoff location is required' })
  @ValidateNested()
  @Type(() => LocationDto)
  dropoff: LocationDto;
}

/**
 * DTO for a single ride option in the estimate response
 */
export class RideOptionDto {
  @ApiProperty({ 
    enum: RideCategory, 
    example: RideCategory.PRIVATE,
    description: 'Internal category ID'
  })
  category: RideCategory;

  @ApiProperty({ 
    example: 'Whole Keke',
    description: 'Name shown to the user'
  })
  displayName: string;

  @ApiProperty({ 
    example: 1200.00,
    description: 'The calculated price for this ride'
  })
  estimatedFare: number;

  @ApiProperty({ 
    example: 5.25,
    description: 'Distance in kilometers'
  })
  distanceKm: number;

  @ApiProperty({ 
    example: 'Best for 1-3 people',
    description: 'Brief description of the service'
  })
  description: string;
}

/**
 * DTO for the estimation response wrapper
 */
export class EstimateResponseDto {
  @ApiProperty({ example: 'Estimates calculated successfully' })
  message: string;

  @ApiProperty({ type: [RideOptionDto] })
  estimates: RideOptionDto[];
}
