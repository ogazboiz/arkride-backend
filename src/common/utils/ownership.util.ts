import { ForbiddenException } from '@nestjs/common';
import { Role } from '../enums/role.enum';

/**
 * The one place "may this principal act on this row?" is decided.
 *
 * Ownership checks were written inline, ad hoc, and inconsistently — present
 * on `PATCH /drivers/:id/online-status` and `GET /ledger/driver/:driverId`,
 * absent on `PATCH /drivers/:id`, `GET /drivers/:id`, `GET /rides/:id`,
 * `GET /rides/user/:userId`, `GET /emergency/ride/:rideId` and the entire
 * vehicles module. Anything written per-handler gets forgotten per-handler.
 *
 * The rule is uniform: an admin may act on anything; anyone else may act only
 * on rows whose owner id equals their own principal id.
 */

/** The minimum an authenticated principal must carry for a decision. */
export interface Principal {
  id: string;
  role: Role;
}

export function isAdmin(principal: Principal | undefined): boolean {
  return principal?.role === Role.ADMIN;
}

/**
 * True when `principal` may act on a resource owned by `ownerId`.
 *
 * A null/undefined `ownerId` returns false for non-admins. An unowned row is
 * not an unprotected row — an unassigned ride must not become readable by
 * everyone just because `driverId` is still null.
 */
export function canActOnBehalfOf(
  principal: Principal | undefined,
  ownerId: string | null | undefined,
): boolean {
  if (!principal) return false;
  if (isAdmin(principal)) return true;
  if (!ownerId) return false;
  return principal.id === ownerId;
}

/**
 * Throw unless the principal owns the resource (or is an admin).
 *
 * `resource` names the thing in the message — "You can only view your own
 * ride history" reads better than a generic 403, and the message is
 * deliberately identical whether the row exists or not, so this cannot be
 * used to probe for which ids are real.
 */
export function assertOwnership(
  principal: Principal | undefined,
  ownerId: string | null | undefined,
  action: string,
): void {
  if (canActOnBehalfOf(principal, ownerId)) return;
  throw new ForbiddenException(`You can only ${action}.`);
}

/**
 * True when the principal is one of the two parties on a ride.
 *
 * Rides have two owners, not one, which is why this exists separately.
 */
export function isPartyToRide(
  principal: Principal | undefined,
  ride: { userId?: string | null; driverId?: string | null } | null | undefined,
): boolean {
  if (!principal || !ride) return false;
  if (isAdmin(principal)) return true;
  if (ride.userId && ride.userId === principal.id) return true;
  if (ride.driverId && ride.driverId === principal.id) return true;
  return false;
}

/** Throw unless the principal is a party to the ride (or an admin). */
export function assertPartyToRide(
  principal: Principal | undefined,
  ride: { userId?: string | null; driverId?: string | null } | null | undefined,
  action: string,
): void {
  if (isPartyToRide(principal, ride)) return;
  throw new ForbiddenException(`You can only ${action} for rides you are part of.`);
}
