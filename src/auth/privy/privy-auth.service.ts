import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PrivyService } from './privy.service';
import { TokenService, SessionTokens } from '../services/token.service';
import { User } from '../../users/entities/user.entity';
import { Driver } from '../../drivers/entities/driver.entity';
import { Role } from '../../common/enums/role.enum';

/** Which side of the platform the caller is signing in as. */
export type PrivyAudience = 'rider' | 'driver';

export interface PrivySignInInput {
  accessToken: string;
  /** Privy's signed identity token, for the embedded wallet. Optional. */
  identityToken?: string | null;
  audience: PrivyAudience;
  /** Only used when provisioning a brand-new rider. */
  name?: string;
  email?: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface PrivySignInResult extends SessionTokens {
  isNewAccount: boolean;
  profile: {
    id: string;
    name: string;
    email: string;
    role: Role;
    privyDid: string;
    walletAddressEvm: string | null;
  };
}

/**
 * Sign in with Privy.
 *
 * THE DESIGN PROBLEM, AND WHY IT IS SOLVED THIS WAY
 *
 * Privy issues ONE DID per person. Ark Rides has TWO identity tables with
 * separate id spaces — `users` (riders) and `drivers` — and every guard, the
 * JWT payload, AuthResolverService and the websocket handshake are all built
 * on that split. A person who both rides and drives legitimately has a row in
 * each.
 *
 * So a DID alone does not determine an account, and the ambiguity has to be
 * resolved SOMEWHERE. Three options were on the table:
 *
 *   (a) Merge the tables. Correct in the long run, and far too large a change
 *       to make underneath a security fix.
 *   (b) Guess — look in `drivers` first, fall back to `users`. Whichever order
 *       you pick, somebody signs into the wrong side of the app, and the bug
 *       only appears for the people who are both.
 *   (c) Make the caller say. The rider app asks for a rider session, the
 *       driver app asks for a driver session. One field, no ambiguity, and it
 *       is information the client always has.
 *
 * This is (c).
 *
 * PROVISIONING: a rider is created on first sign-in — that is the whole point
 * of social login. A DRIVER is not: driving requires a licence, a vehicle and
 * an admin approval, so an unknown DID asking for a driver session is told to
 * register rather than being handed an unverified driver account.
 */
@Injectable()
export class PrivyAuthService {
  private readonly logger = new Logger(PrivyAuthService.name);

  constructor(
    private readonly privy: PrivyService,
    private readonly tokens: TokenService,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Driver) private readonly drivers: Repository<Driver>,
  ) {}

  async signIn(input: PrivySignInInput): Promise<PrivySignInResult> {
    if (!this.privy.isConfigured) {
      // A distinct status from 401 on purpose: this is our deployment being
      // wrong, not the caller's token. Reporting it as "invalid token" sends
      // a client debugging something that is not broken.
      throw new ServiceUnavailableException(
        'Privy sign-in is not configured on this server.',
      );
    }

    const did = await this.privy.verifyAccessToken(input.accessToken);
    if (!did) {
      throw new UnauthorizedException('Invalid Privy access token.');
    }

    // Best-effort. A missing or stale identity token must not block sign-in;
    // it only means we do not learn the wallet on this attempt.
    const wallet = await this.privy.walletFromIdentityToken(input.identityToken);

    return input.audience === 'driver'
      ? this.signInDriver(did, wallet, input)
      : this.signInRider(did, wallet, input);
  }

  /** Riders are provisioned on first sign-in. */
  private async signInRider(
    did: string,
    wallet: string | null,
    input: PrivySignInInput,
  ): Promise<PrivySignInResult> {
    let user = await this.users.findOne({ where: { privyDid: did } });
    let isNewAccount = false;

    if (!user && input.email) {
      // An existing password account with the same verified email is the SAME
      // person, so link rather than create a second row that would collide on
      // the unique email column anyway.
      const byEmail = await this.users.findOne({
        where: { email: input.email.toLowerCase() },
      });
      if (byEmail) {
        if (byEmail.privyDid && byEmail.privyDid !== did) {
          // Two different DIDs claiming one email. Refuse rather than
          // re-point the account — this is the shape an account-takeover
          // attempt would have.
          throw new ForbiddenException(
            'This email is already linked to a different Privy account.',
          );
        }
        byEmail.privyDid = did;
        user = byEmail;
      }
    }

    if (!user) {
      user = this.users.create({
        privyDid: did,
        name: input.name?.trim() || 'Ark Rider',
        // Privy accounts may have no email at all (phone or wallet login), so
        // a placeholder keyed on the DID keeps the NOT NULL unique column
        // satisfiable without inventing a plausible-looking address that
        // could collide with a real one.
        email: input.email?.toLowerCase() || `${did}@privy.arkrides.local`,
        // Privy verified the identity; there is nothing for our OTP to add.
        isVerified: true,
        role: Role.USER,
        password: null,
      });
      isNewAccount = true;
    }

    if (user.isBlocked) {
      throw new ForbiddenException('Your account has been blocked.');
    }

    if (wallet && user.walletAddressEvm?.toLowerCase() !== wallet) {
      user.walletAddressEvm = wallet;
    }

    const saved = await this.users.save(user);

    const tokens = await this.tokens.issueSession(
      { id: saved.id, role: Role.USER, isDriver: false },
      { userAgent: input.userAgent, ipAddress: input.ipAddress },
    );

    this.logger.log({
      message: isNewAccount
        ? 'Provisioned a rider from Privy'
        : 'Rider signed in with Privy',
      userId: saved.id,
      hasWallet: Boolean(saved.walletAddressEvm),
    });

    return {
      ...tokens,
      isNewAccount,
      profile: {
        id: saved.id,
        name: saved.name,
        email: saved.email,
        role: Role.USER,
        privyDid: did,
        walletAddressEvm: saved.walletAddressEvm,
      },
    };
  }

  /**
   * Drivers are NOT provisioned here.
   *
   * A driver account implies a licence, a vehicle and an admin approval.
   * Minting one from a social login would create an unverified driver, and the
   * "only approved drivers can go online" rule would then be the only thing
   * standing between that account and carrying a passenger.
   */
  private async signInDriver(
    did: string,
    wallet: string | null,
    input: PrivySignInInput,
  ): Promise<PrivySignInResult> {
    let driver = await this.drivers.findOne({ where: { privyDid: did } });

    if (!driver && input.email) {
      const byEmail = await this.drivers.findOne({
        where: { email: input.email.toLowerCase() },
      });
      if (byEmail) {
        if (byEmail.privyDid && byEmail.privyDid !== did) {
          throw new ForbiddenException(
            'This email is already linked to a different Privy account.',
          );
        }
        byEmail.privyDid = did;
        driver = byEmail;
      }
    }

    if (!driver) {
      throw new BadRequestException(
        'No driver account is linked to this Privy identity. ' +
          'Register as a driver first, then link Privy from your profile.',
      );
    }

    if (!driver.isActive) {
      throw new ForbiddenException('Your driver account has been deactivated.');
    }

    if (wallet && driver.walletAddressEvm?.toLowerCase() !== wallet) {
      driver.walletAddressEvm = wallet;
    }

    const saved = await this.drivers.save(driver);

    const tokens = await this.tokens.issueSession(
      { id: saved.id, role: Role.DRIVER, isDriver: true },
      { userAgent: input.userAgent, ipAddress: input.ipAddress },
    );

    this.logger.log({
      message: 'Driver signed in with Privy',
      driverId: saved.id,
      verificationStatus: saved.verificationStatus,
    });

    return {
      ...tokens,
      isNewAccount: false,
      profile: {
        id: saved.id,
        name: saved.name,
        email: saved.email,
        role: Role.DRIVER,
        privyDid: did,
        walletAddressEvm: saved.walletAddressEvm,
      },
    };
  }
}
