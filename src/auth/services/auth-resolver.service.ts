import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../../users/users.service';
import { DriversService } from '../../drivers/drivers.service';
import { Role } from '../../common/enums/role.enum';

/**
 * What a verified JWT resolves to.
 * Mirrors what JwtStrategy.validate() puts on `req.user`.
 */
export interface ResolvedPrincipal {
  id: string;
  role: Role;
  name?: string;
  email?: string;
  [key: string]: any;
}

/**
 * AuthResolverService
 *
 * Purpose: Turn a decoded JWT payload into the User or Driver it refers to.
 *
 * Why this is its own service:
 * Riders and drivers live in two separate tables with two separate id spaces,
 * so "which row is this token about" is real branching logic, not a lookup.
 * It used to live inline in JwtStrategy, which meant the websocket gateway
 * would have had to reimplement it — and a copy that drifts would resolve a
 * driver token to a user row with the same id. One implementation, two callers.
 */
@Injectable()
export class AuthResolverService {
  private readonly logger = new Logger(AuthResolverService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly driversService: DriversService,
  ) {}

  /**
   * Resolve a verified token into the principal it names.
   *
   * TWO RULES, both of which were broken:
   *
   * 1. The ROLE COMES FROM THE DATABASE, never from the token.
   *
   *    This used to `return { ...user, role: Role.ADMIN }` whenever the
   *    payload said `role: 'admin'`, without ever checking `user.role`. So
   *    demoting an admin in the database did nothing until their access token
   *    expired — for a full hour they kept `GET /stats/revenue`,
   *    `GET /ledger/summary` and `PATCH /drivers/:id/verification-status`.
   *    Re-reading the subject on refresh (AuthService.refreshSession) is
   *    pointless if the access-token path, which is the one that actually
   *    authorizes requests, trusts a claim instead.
   *
   *    The token still says which TABLE to look in — riders and drivers have
   *    separate id spaces, so that part is genuinely needed and is not a
   *    privilege claim.
   *
   * 2. CREDENTIALS DO NOT GO ON `req.user`.
   *
   *    `usersService.findById` returns the whole entity with no projection, so
   *    `{ ...user }` put the bcrypt hash plus `otpCode` / `otpExpiry` on the
   *    request object for every authenticated call. Nothing returns `req.user`
   *    today — but `@CurrentUser()` hands that object to every controller, and
   *    one `return principal` is all it would take.
   */
  async resolvePrincipal(payload: any): Promise<ResolvedPrincipal> {
    const { sub } = payload ?? {};

    if (!sub) {
      throw new UnauthorizedException('Token is missing a subject');
    }

    // `type` selects the identity TABLE. It is not a permission.
    if (payload?.type === 'driver') {
      const driver = await this.driversService.findForAuth(sub);
      if (!driver) {
        throw new UnauthorizedException('Invalid driver token');
      }
      // No isActive check here: `findForAuth` queries
      // `where: { id, isActive: true }`, so a deactivated driver already
      // resolves to null above. Repeating it would be dead code that only
      // misfires when the field is absent.
      return {
        ...stripCredentials(driver),
        // From the row, not the token.
        role: driver.role ?? Role.DRIVER,
      };
    }

    const user = await this.usersService.findById(sub);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    if (user.isBlocked) {
      // The drivers branch already refused deactivated drivers; riders had no
      // equivalent check, so a blocked rider kept full access for the life of
      // their token.
      throw new UnauthorizedException('This account has been blocked');
    }

    return {
      ...stripCredentials(user),
      role: user.role ?? Role.USER,
    };
  }
}

/**
 * Remove everything secret before an entity becomes `req.user`.
 *
 * Deliberately a denylist of the credential columns rather than an allowlist
 * of safe ones: controllers already read assorted fields off the principal,
 * and an allowlist would break them silently. The three names here are the
 * only secrets either table holds, and a new one would have to be added
 * consciously — which is the right amount of friction for adding a secret.
 *
 * Exported for the unit test.
 */
export function stripCredentials<T extends object>(
  entity: T,
): Omit<T, 'password' | 'otpCode' | 'otpExpiry'> {
  const { password, otpCode, otpExpiry, ...safe } = entity as T &
    Partial<Record<'password' | 'otpCode' | 'otpExpiry', unknown>>;
  return safe as Omit<T, 'password' | 'otpCode' | 'otpExpiry'>;
}
