import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateDriverOnlineStatusDto {
  /**
   * Whether the driver is available to receive rides.
   *
   * Going ONLINE requires an approved licence and an active account; going
   * OFFLINE is always allowed, so that a suspended driver can still take
   * themselves out of dispatch. Both rules live in
   * `DriversService.updateOnlineStatus`.
   */
  @ApiProperty({
    example: true,
    description:
      'true to receive ride requests, false to stop. Only approved, active drivers may go online.',
  })
  // Required, and typed as such.
  //
  // It was `isOnline?: boolean` with `@IsNotEmpty()`, which is a contradiction:
  // the type said the field was optional while the validator rejected an absent
  // one, and the handler read `!!dto?.isOnline` — so an omitted field would have
  // meant "go offline" if it had ever got past validation.
  //
  // `@Type(() => Boolean)` was also on here and did nothing: it is a no-op for a
  // JSON body, where `true` is already a boolean, and it would have coerced the
  // STRING "false" to `true` had it applied.
  @IsBoolean({ message: 'isOnline must be true or false' })
  isOnline!: boolean;
}
