import { IsString, IsOptional, Matches, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * What a driver may change about themselves.
 *
 * SECURITY NOTE — this DTO used to be `extends PartialType(CreateDriverDto)`
 * and additionally declared `verificationStatus`, `isActive` and `isOnline`.
 * The handler was `@Roles(DRIVER, ADMIN)` with no ownership check and the
 * service did `Object.assign(driver, dto)`. Together that meant any
 * authenticated driver could:
 *
 *   PATCH /api/v1/drivers/<someone-else's-id>
 *   { "verificationStatus": "approved" }      -> self-approve onto the road
 *   { "email": "...", "password": "..." }     -> take over another account
 *   { "isActive": false }                     -> remove a competitor
 *
 * `PartialType(CreateDriverDto)` was the subtle half: it silently re-admits
 * every creation field, so `email` and `password` were whitelisted even
 * though this class never mentioned them. That is why this is now a
 * standalone class and not a PartialType — the allowlist has to be written
 * out, not inherited.
 *
 * Deliberately ABSENT, and where each one moved to:
 *   email               -> nowhere. Changing it re-opens identity verification.
 *   password            -> POST /drivers/forgot-password + /reset-password.
 *   verificationStatus  -> PATCH /drivers/:id/verification-status (ADMIN).
 *   isActive            -> PATCH /drivers/:id/active-status (ADMIN).
 *   isOnline            -> PATCH /drivers/:id/online-status (self, ownership-checked).
 *   vehicle* fields     -> the vehicles module. They were never Driver columns;
 *                          TypeORM dropped them and the write silently no-oped.
 */
export class UpdateDriverDto {
  @ApiPropertyOptional({ example: 'Amina Yusuf' })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters' })
  name?: string;

  @ApiPropertyOptional({
    example: '08012345678',
    description: 'Nigerian mobile number, local or +234 form.',
  })
  @IsOptional()
  @IsString()
  // One phone format for the whole codebase. There were four competing
  // regexes across the DTOs writing into the same two columns.
  @Matches(/^(\+234|0)[789][01]\d{8}$/, {
    message:
      'Phone number must be a Nigerian mobile number, e.g. 08012345678 or +2348012345678',
  })
  phone?: string;

  @ApiPropertyOptional({ example: 'LAG-DRV-2025-001' })
  @IsOptional()
  @IsString()
  licenseNumber?: string;

  @ApiPropertyOptional({ example: '2028-12-31' })
  @IsOptional()
  @IsString()
  licenseExpiry?: string;
}
