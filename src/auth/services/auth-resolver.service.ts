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

  async resolvePrincipal(payload: any): Promise<ResolvedPrincipal> {
    const { sub, role } = payload ?? {};

    if (!sub) {
      throw new UnauthorizedException('Token is missing a subject');
    }

    // Drivers are a separate identity table, flagged by `type` on the payload
    if (payload.type === 'driver' && role === Role.DRIVER) {
      const driver = await this.driversService.findForAuth(sub);
      if (!driver) {
        throw new UnauthorizedException('Invalid driver token');
      }
      return { ...driver, role: Role.DRIVER };
    }

    if (role === Role.ADMIN) {
      const user = await this.usersService.findById(sub);
      if (!user) {
        throw new UnauthorizedException('Admin user not found');
      }
      return { ...user, role: Role.ADMIN };
    }

    const user = await this.usersService.findById(sub);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return { ...user, role: Role.USER };
  }
}
