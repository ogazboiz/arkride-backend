import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, IsNull, Not } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { RefreshToken } from '../entities/refresh-token.entity';
import { Role } from '../../common/enums/role.enum';

/** How long a refresh token stays usable. */
export const REFRESH_TOKEN_TTL_DAYS = 30;

/** What a caller gets back from sign-in or refresh. */
export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the ACCESS token expires — clients schedule refresh on it. */
  expiresIn: number;
  tokenType: 'Bearer';
}

/** Who a session belongs to. */
export interface SessionSubject {
  id: string;
  role: Role;
  /** Mirrors the existing `type: 'driver'` claim AuthResolverService branches on. */
  isDriver: boolean;
}

/**
 * Issues, rotates and revokes sessions.
 *
 * See RefreshToken for why the table exists and why rotation works the way it
 * does. This class is the only thing that writes it.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * A brand-new session. Starts a new token family.
   *
   * `context` is recorded for the audit trail only — see the entity for why it
   * deliberately does not participate in validation.
   */
  async issueSession(
    subject: SessionSubject,
    context: { userAgent?: string | null; ipAddress?: string | null } = {},
  ): Promise<SessionTokens> {
    return this.mint(subject, randomUUID(), context);
  }

  /**
   * Exchange a refresh token for a new pair, consuming the old one.
   *
   * Throws Unauthorized for anything that is not a live token: unknown,
   * expired, or already used. The message is the same in every case, because
   * telling a caller *which* one it was tells them whether the token ever
   * existed.
   */
  async rotate(
    presentedToken: string,
    resolveSubject: (
      subjectId: string,
      subjectType: Role,
    ) => Promise<SessionSubject | null>,
    context: { userAgent?: string | null; ipAddress?: string | null } = {},
  ): Promise<SessionTokens> {
    const tokenHash = hashToken(presentedToken);
    const stored = await this.refreshTokens.findOne({ where: { tokenHash } });

    if (!stored) {
      throw new UnauthorizedException('Invalid or expired session.');
    }

    if (stored.revokedAt) {
      // REUSE DETECTION, but only for a token that was CONSUMED BY A ROTATION.
      //
      // That is the case that means two parties hold one token: it was
      // exchanged once and is being exchanged again. There is no way to tell
      // the thief from the owner, so the entire family goes.
      //
      // A token revoked by an explicit logout, or by an admin, is a different
      // thing entirely — the session is already deliberately dead, and a
      // client retrying after a dropped logout response is not an attack.
      // Treating that as a breach would also overwrite the audit reason, so a
      // logout would end up recorded as a compromise.
      if (stored.revokedReason === 'rotated') {
        this.logger.warn({
          message: 'Refresh token reuse detected — revoking the whole session family',
          familyId: stored.familyId,
          subjectId: stored.subjectId,
        });
        await this.revokeFamily(stored.familyId, 'reuse-detected');
      }
      throw new UnauthorizedException('Invalid or expired session.');
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Invalid or expired session.');
    }

    // CONSUME IT FIRST, and let the database decide who won.
    //
    // The read above is only a hint. Checking `revokedAt` in JavaScript and
    // then updating is a TOCTOU: two concurrent refreshes with the same token
    // both read `revokedAt = null`, both pass the check, both write, and both
    // mint — leaving two live tokens in one family with reuse detection never
    // firing. That is precisely the fork this class exists to prevent, and it
    // is reachable by a thief simply firing their refresh at the same moment
    // as the victim's.
    //
    // `WHERE revokedAt IS NULL` makes the claim atomic. Exactly one caller can
    // get `affected === 1`; everyone else gets 0 and is treated as reuse.
    const claimed = await this.refreshTokens.update(
      { id: stored.id, revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: 'rotated' },
    );

    if (!claimed.affected) {
      // Someone else consumed it between our read and our write. Same
      // conclusion as a replay: two parties hold this token.
      this.logger.warn({
        message: 'Refresh token consumed concurrently — revoking the family',
        familyId: stored.familyId,
        subjectId: stored.subjectId,
      });
      await this.revokeFamily(stored.familyId, 'reuse-detected');
      throw new UnauthorizedException('Invalid or expired session.');
    }

    // Re-read the subject AFTER the claim. This is what makes a suspension
    // take effect within the access-token lifetime rather than at the end of a
    // 30-day refresh window — and doing it after the claim means a token is
    // never left spendable when the subject turns out to be gone.
    const subject = await resolveSubject(stored.subjectId, stored.subjectType);
    if (!subject) {
      await this.revokeFamily(stored.familyId, 'subject-unavailable');
      throw new UnauthorizedException('Invalid or expired session.');
    }

    const session = await this.mint(subject, stored.familyId, context);

    // One more check, and it is not paranoia.
    //
    // The atomic claim above decides who consumes the old token, but the LOSER
    // of a race revokes the family a moment later — and by then we may already
    // have minted. Without this, the winner walks away with a live session
    // from a family that has been declared compromised. If the winner is the
    // thief, the victim is locked out and the thief is not.
    //
    // A compromised family means nobody keeps the session. Both parties
    // re-authenticate; that is the correct answer to "one of you is not who
    // you say you are, and we cannot tell which".
    const breached = await this.refreshTokens.findOne({
      where: { familyId: stored.familyId, revokedReason: 'reuse-detected' },
    });

    if (breached) {
      await this.revokeFamily(stored.familyId, 'reuse-detected');
      throw new UnauthorizedException('Invalid or expired session.');
    }

    return session;
  }

  /**
   * End one session.
   *
   * Idempotent and silent about whether the token existed: logout must not be
   * a way to probe which tokens are real, and a client retrying a logout after
   * a dropped response should not see an error.
   */
  async revokeByToken(presentedToken: string): Promise<void> {
    const stored = await this.refreshTokens.findOne({
      where: { tokenHash: hashToken(presentedToken) },
    });
    if (!stored || stored.revokedAt) return;
    await this.revokeFamily(stored.familyId, 'logout');
  }

  /** End every session for one account — used on suspension and on deletion. */
  async revokeAllForSubject(subjectId: string, subjectType: Role): Promise<void> {
    await this.refreshTokens.update(
      { subjectId, subjectType, revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: 'subject-revoked' },
    );
  }

  /**
   * Revoke every live token in a family.
   *
   * A REUSE-DETECTED revocation additionally re-stamps rows that were already
   * revoked. That looks redundant and is not: when a race is lost, the winner
   * has usually already consumed the only live row as 'rotated', so there is
   * nothing left for the first UPDATE to touch and the family carries no
   * evidence of the breach at all. The winner's post-mint integrity check
   * looks for exactly that evidence, so without this the compromised session
   * survives.
   *
   * A breach is also simply the more important fact about a token than the
   * fact that it was rotated, so overwriting the reason is right on its own
   * terms for the audit trail.
   */
  private async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.refreshTokens.update(
      { familyId, revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: reason },
    );

    if (reason === 'reuse-detected') {
      await this.refreshTokens.update({ familyId }, { revokedReason: reason });
    }
  }

  /**
   * Delete tokens that expired more than a grace period ago.
   *
   * The grace period is deliberate: a token has to stay READABLE for a while
   * after it expires, otherwise reuse detection cannot distinguish "stolen
   * token replayed" from "token we have never seen", and a thief could evade
   * the family revoke simply by waiting.
   */
  async pruneExpired(graceDays = 7): Promise<number> {
    const cutoff = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1000);

    // Note there is NO `revokedAt: Not(IsNull())` condition here.
    //
    // It used to be there, and it meant a token that simply EXPIRED without
    // ever being used or revoked was never deleted at all — which is most of
    // them, on a service where people stop opening the app. The table grew
    // without bound and took the tokenHash unique index with it.
    //
    // Expiry past the grace period is sufficient on its own: such a token
    // cannot be exchanged, and it is far enough past the reuse-detection
    // window that keeping it proves nothing.
    const result = await this.refreshTokens.delete({
      expiresAt: LessThan(cutoff),
    });
    return result.affected ?? 0;
  }

  /** Sign the access token and persist a fresh refresh token in `familyId`. */
  private async mint(
    subject: SessionSubject,
    familyId: string,
    context: { userAgent?: string | null; ipAddress?: string | null },
  ): Promise<SessionTokens> {
    // The payload shape is unchanged — AuthResolverService and the websocket
    // gateway both branch on `type === 'driver'` plus `role`, and this is not
    // the change to alter that under them.
    const accessToken = this.jwtService.sign({
      sub: subject.id,
      role: subject.role,
      ...(subject.isDriver ? { type: 'driver' } : {}),
    });

    const refreshToken = randomBytes(32).toString('base64url');

    await this.refreshTokens.save(
      this.refreshTokens.create({
        tokenHash: hashToken(refreshToken),
        familyId,
        subjectId: subject.id,
        subjectType: subject.role,
        expiresAt: new Date(
          Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
        ),
        userAgent: context.userAgent?.slice(0, 255) ?? null,
        ipAddress: context.ipAddress ?? null,
      }),
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: 3600,
      tokenType: 'Bearer',
    };
  }
}

/**
 * SHA-256 of a refresh token, hex.
 *
 * Exported for the test. Not bcrypt: the token is 32 bytes of CSPRNG output,
 * so there is no low-entropy secret for a work factor to protect, and this
 * runs on the hot path of every refresh.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
