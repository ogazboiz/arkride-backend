import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsUUID,
  ValidateNested,
  Min,
  Max,
  IsEnum,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RideCategory, RideOriginChannel } from '../entities/ride.entity';

/**
 * DTO for location data (pickup or dropoff)
 * Contains full address and GPS coordinates
 */
export class LocationDto {
  @ApiProperty({ example: '12 Allen Avenue, Ikeja, Lagos' })
  @IsNotEmpty({ message: 'Address is required' })
  @IsString()
  address: string;

  @ApiProperty({ example: 6.6018, minimum: -90, maximum: 90 })
  @IsNotEmpty({ message: 'Latitude is required' })
  @IsNumber()
  @Min(-90, { message: 'Latitude must be between -90 and 90' })
  @Max(90, { message: 'Latitude must be between -90 and 90' })
  lat: number;

  @ApiProperty({ example: 3.3515, minimum: -180, maximum: 180 })
  @IsNotEmpty({ message: 'Longitude is required' })
  @IsNumber()
  @Min(-180, { message: 'Longitude must be between -180 and 180' })
  @Max(180, { message: 'Longitude must be between -180 and 180' })
  lng: number;
}

/**
 * DTO for creating a new ride request
 * Users submit this when they need a ride
 */
export class CreateRideDto {
  // The user requesting the ride (from JWT token in real implementation)
  @ApiProperty({ example: '123e4567-e89b-42d3-a456-426614174000' })
  @IsNotEmpty({ message: 'User ID is required' })
  @IsUUID('4', { message: 'User ID must be a valid UUID' })
  userId: string;

  // Where the user wants to be picked up
  @ApiProperty({ type: () => LocationDto })
  @IsNotEmpty({ message: 'Pickup location is required' })
  @ValidateNested()
  @Type(() => LocationDto)
  pickup: LocationDto;

  // Where the user wants to go
  @ApiProperty({ type: () => LocationDto })
  @IsNotEmpty({ message: 'Dropoff location is required' })
  @ValidateNested()
  @Type(() => LocationDto)
  dropoff: LocationDto;

  // The category of ride (Private, Shared, Okada)
  @ApiProperty({
    enum: RideCategory,
    example: RideCategory.PRIVATE,
    description: 'The type of service requested (private = whole keke, shared = shared keke, okada = motorcycle, car = car)'
  })
  @IsNotEmpty({ message: 'Ride category is required' })
  @IsEnum(RideCategory, {
    message: 'Category must be one of: private, shared, okada, car',
  })
  category: RideCategory;

  /**
   * Which entry point produced this booking. Optional and defaulted, so
   * existing app clients are unaffected — only the omnichannel service sets it.
   */
  @ApiPropertyOptional({
    enum: RideOriginChannel,
    default: RideOriginChannel.APP,
    description: 'Booking channel, for attribution',
  })
  @IsOptional()
  @IsEnum(RideOriginChannel, {
    message: 'Origin channel must be one of: app, whatsapp, voice',
  })
  originChannel?: RideOriginChannel;
}
