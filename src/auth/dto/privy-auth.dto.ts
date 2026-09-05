import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Which side of the platform this session is for. */
export enum PrivyAudienceDto {
  RIDER = 'rider',
  DRIVER = 'driver',
}

export class PrivySignInDto {
  @ApiProperty({
    description: "Privy access token from the client SDK's getAccessToken().",
    example: 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsNotEmpty({ message: 'A Privy access token is required' })
  @IsString()
  accessToken!: string;

  @ApiPropertyOptional({
    description:
      "Privy identity token (the client's privy-id-token). Supplying it lets " +
      'the server record the embedded wallet. Verified server-side, never trusted.',
  })
  @IsOptional()
  @IsString()
  identityToken?: string;

  @ApiProperty({
    enum: PrivyAudienceDto,
    example: PrivyAudienceDto.RIDER,
    description:
      'Riders and drivers are separate accounts with separate id spaces, and ' +
      'one Privy DID may own one of each. The client states which it wants ' +
      'rather than the server guessing.',
  })
  @IsEnum(PrivyAudienceDto, { message: 'audience must be rider or driver' })
  audience!: PrivyAudienceDto;

  @ApiPropertyOptional({
    example: 'Amina Yusuf',
    description: 'Used only when provisioning a brand-new rider.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  // NOTE: there is deliberately NO `email` field.
  //
  // It used to be here, and it was an account takeover: the address was taken
  // from this body and used to link a Privy DID onto an existing account, so
  // anyone with their own valid Privy token could name a victim's address and
  // be handed that account — plus have the victim's payout wallet repointed.
  //
  // The email used for linking now comes from Privy's SIGNED identity token
  // (send it as `identityToken`, or as the `privy-id-token` header). Do not
  // reintroduce this field.
}

/**
 * Provision a driver from a verified Privy identity plus the details the driver
 * app collects. Like {@link PrivySignInDto} there is deliberately NO `email` —
 * the address is read only from the SIGNED Privy token, never this body.
 */
export class PrivyDriverRegisterDto {
  @ApiProperty({
    description: "Privy access token from the client SDK's getAccessToken().",
  })
  @IsNotEmpty({ message: 'A Privy access token is required' })
  @IsString()
  accessToken!: string;

  @ApiPropertyOptional({
    description:
      "Privy identity token (the client's privy-id-token). Verified " +
      'server-side; supplies the verified email and embedded wallet.',
  })
  @IsOptional()
  @IsString()
  identityToken?: string;

  @ApiProperty({ example: 'Amina Yusuf' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({
    example: '+2348012345678',
    description: 'Valid Nigerian phone number',
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/^(\+234|0)[789]\d{9}$/, {
    message: 'Phone number must be a valid Nigerian phone number',
  })
  phone!: string;

  @ApiProperty({ example: 'LAG-DRV-2025-001' })
  @IsNotEmpty()
  @IsString()
  licenseNumber!: string;

  @ApiProperty({ example: '2028-12-31', description: 'ISO date string' })
  @IsNotEmpty()
  @IsDateString()
  licenseExpiry!: string;

  @ApiProperty({ example: 'car', enum: ['keke', 'bike', 'car', 'courier'] })
  @IsNotEmpty()
  @IsString()
  vehicleType!: string;

  @ApiProperty({ example: 'ABC-123XY' })
  @IsNotEmpty()
  @IsString()
  plateNumber!: string;

  @ApiProperty({ example: 'Yellow' })
  @IsNotEmpty()
  @IsString()
  vehicleColor!: string;

  @ApiProperty({ example: 'Toyota Corolla' })
  @IsNotEmpty()
  @IsString()
  vehicleModel!: string;

  @ApiProperty({ example: '2024' })
  @IsNotEmpty()
  @IsString()
  vehicleYear!: string;
}

export class RefreshSessionDto {
  @ApiProperty({ description: 'The refresh token returned by sign-in.' })
  @IsNotEmpty({ message: 'A refresh token is required' })
  @IsString()
  refreshToken!: string;
}
