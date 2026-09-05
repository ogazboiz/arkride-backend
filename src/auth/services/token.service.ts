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

    // REUSE DETECTION. A consumed token being presented again means two
    // parties hold it. There is no way to tell the thief from the owner, so
    // the entire family goes.
    if (stored.revokedAt) {
      this.logger.warn({
        message: 'Refresh token reuse detected — revoking the whole session family',
        familyId: stored.familyId,
        subjectId: stored.subjectId,
        originallyRevokedFor: stored.revokedReason,
      });
      await this.revokeFamily(stored.familyId, 'reuse-detected');
      throw new UnauthorizedException('Invalid or expired session.');
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Invalid or expired session.');
    }

    // Re-read the subject on every refresh. This is what makes a suspension
    // take effect within the access-token lifetime rather than at the end of
    // a 30-day refresh window.
    const subject = await resolveSubject(stored.subjectId, stored.subjectType);
    if (!subject) {
      await this.revokeFamily(stored.familyId, 'subject-unavailable');
      throw new UnauthorizedException('Invalid or expired session.');
    }

    await this.refreshTokens.update(stored.id, {
      revokedAt: new Date(),
      revokedReason: 'rotated',
    });

    return this.mint(subject, stored.familyId, context);
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

  /** Revoke every live token in a family. */
  private async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.refreshTokens.update(
      { familyId, revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: reason },
    );
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
    const result = await this.refreshTokens.delete({
      expiresAt: LessThan(cutoff),
      revokedAt: Not(IsNull()),
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
