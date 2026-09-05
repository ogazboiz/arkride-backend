import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
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

export class RefreshSessionDto {
  @ApiProperty({ description: 'The refresh token returned by sign-in.' })
  @IsNotEmpty({ message: 'A refresh token is required' })
  @IsString()
  refreshToken!: string;
}
