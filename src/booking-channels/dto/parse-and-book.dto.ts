import {
  IsNotEmpty,
  IsString,
  IsEnum,
  IsOptional,
  ValidateNested,
  Matches,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LocationDto } from '../../rides/dto/create-ride.dto';
import { RideOriginChannel } from '../../rides/entities/ride.entity';

/**
 * DTO for a booking arriving from a chat agent or voice transcript.
 *
 * Voice callers send text: speech-to-text happens at the telephony layer, not
 * here. From this endpoint's perspective WhatsApp and voice differ only in the
 * channel tag.
 */
export class ParseAndBookDto {
  @ApiProperty({
    example: 'Book a car from FUTA to Market Square',
    description: 'The raw message, or the voice transcript',
  })
  @IsNotEmpty({ message: 'Message text is required' })
  @IsString()
  @MaxLength(500)
  rawText: string;

  @ApiProperty({
    enum: [RideOriginChannel.WHATSAPP, RideOriginChannel.VOICE],
    example: RideOriginChannel.WHATSAPP,
  })
  @IsNotEmpty({ message: 'Channel is required' })
  @IsEnum(RideOriginChannel, {
    message: 'Channel must be one of: app, whatsapp, voice',
  })
  channel: RideOriginChannel;

  @ApiPropertyOptional({
    example: '+2348012345678',
    description: 'Caller identity. Used to find or create the rider account.',
  })
  @IsOptional()
  @Matches(/^\+?[0-9]{7,15}$/, {
    message: 'Caller phone must be a valid phone number',
  })
  callerPhone?: string;

  @ApiPropertyOptional({
    type: () => LocationDto,
    description:
      'Pre-resolved pickup (e.g. a WhatsApp location pin). Preferred over geocoding the text.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  pickup?: LocationDto;

  @ApiPropertyOptional({
    type: () => LocationDto,
    description: 'Pre-resolved dropoff, if the caller already has coordinates.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  dropoff?: LocationDto;
}
