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
    description: 'The pickup location coordinates and address',
  })
  @IsNotEmpty({ message: 'Pickup location is required' })
  @ValidateNested()
  @Type(() => LocationDto)
  pickup: LocationDto;

  @ApiProperty({
    type: () => LocationDto,
    description: 'The destination location coordinates and address',
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
    description: 'Internal category ID',
  })
  category: RideCategory;

  @ApiProperty({
    example: 'Whole Keke',
    description: 'Name shown to the user',
  })
  displayName: string;

  @ApiProperty({
    example: 1200.0,
    description: 'The calculated price for this ride',
  })
  estimatedFare: number;

  @ApiProperty({
    example: 5.25,
    description: 'Distance in kilometers',
  })
  distanceKm: number;

  @ApiProperty({
    example: 'Best for 1-3 people',
    description: 'Brief description of the service',
  })
  description: string;
}

/**
 * REMOVED: `EstimateResponseDto`.
 *
 * It described `{ message, estimates }` — a wrapper the handler stopped
 * producing when responses moved to the global envelope. The endpoint returns
 * the ride options as a bare array, which the interceptor puts at `data`, so
 * the documented shape had TWO independent errors: no envelope, and a key
 * (`estimates`) that does not exist. A generated client dereferencing
 * `response.estimates` got `undefined`.
 *
 * The handler now declares `type: [RideOptionDto]` and the Swagger
 * post-processor wraps it as the envelope's `data` — see
 * `common/swagger/document-envelope.ts`. An actively wrong contract is worse
 * than no contract, so this class is gone rather than corrected in place.
 */
