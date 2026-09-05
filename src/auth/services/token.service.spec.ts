import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { TokenService, hashToken, SessionSubject } from './token.service';
import { RefreshToken } from '../entities/refresh-token.entity';
import { Role } from '../../common/enums/role.enum';

/**
 * An in-memory stand-in for the refresh_tokens repository.
 *
 * Hand-written rather than mocked call-by-call, because the behaviour under
 * test IS the sequence of reads and writes — rotate must consume the old row
 * before it issues the new one, and reuse detection depends on the consumed
 * row still being findable. A `jest.fn()` per method would let a broken
 * ordering pass.
 */
class FakeRefreshTokenRepo {
  rows: RefreshToken[] = [];

  /**
   * Enough of an EntityManager for `rotate` to enlist in.
   *
   * Runs the callback immediately against this same store — which does NOT
   * model rollback. That limitation is stated on the concurrency test itself,
   * because a fake that silently pretends to be transactional is worse than no
   * fake at all.
   */
  manager = {
    transaction: <T>(fn: (m: unknown) => Promise<T>): Promise<T> =>
      fn({ getRepository: () => this }),
    getRepository: () => this,
  };

  create(data: Partial<RefreshToken>): RefreshToken {
    return { id: `row-${this.rows.length + 1}`, ...data } as RefreshToken;
  }

  save(row: RefreshToken): Promise<RefreshToken> {
    this.rows.push(row);
    return Promise.resolve(row);
  }

  findOne({
    where,
  }: {
    where: Partial<RefreshToken>;
  }): Promise<RefreshToken | null> {
    const found = this.rows.find((row) =>
      Object.entries(where).every(
        ([key, value]) => (row as any)[key] === value,
      ),
    );
    return Promise.resolve(found ?? null);
  }

  update(
    criteria: string | Record<string, unknown>,
    patch: Partial<RefreshToken>,
  ): Promise<{ affected: number }> {
    const matches =
      typeof criteria === 'string'
        ? this.rows.filter((row) => row.id === criteria)
        : this.rows.filter((row) =>
            Object.entries(criteria).every(([key, value]) => {
              // The service passes IsNull() for revokedAt; emulate it.
              if (value && typeof value === 'object') {
                return (row as any)[key] == null;
              }
              return (row as any)[key] === value;
            }),
          );
    for (const row of matches) Object.assign(row, patch);
    return Promise.resolve({ affected: matches.length });
  }

  delete(): Promise<{ affected: number }> {
    return Promise.resolve({ affected: 0 });
  }
}

const rider: SessionSubject = {
  id: 'user-1',
  role: Role.USER,
  isDriver: false,
};
const driver: SessionSubject = {
  id: 'driver-1',
  role: Role.DRIVER,
  isDriver: true,
};

describe('TokenService', () => {
  let service: TokenService;
  let repo: FakeRefreshTokenRepo;
  let sign: jest.Mock;

  beforeEach(async () => {
    repo = new FakeRefreshTokenRepo();
    sign = jest.fn(() => 'signed-access-token');

    const moduleRef = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: getRepositoryToken(RefreshToken), useValue: repo },
        { provide: JwtService, useValue: { sign } },
      ],
    }).compile();

    service = moduleRef.get(TokenService);
  });

  /**
   * A resolver stand-in for tests that are not about revocation.
   *
   * Returns a resolved promise rather than being an `async` function with no
   * `await` in it — the real resolver hits the database, this has nothing to
   * wait for, and the signature the service calls is the same either way.
   */
  const alwaysResolve = (subject: SessionSubject) => () =>
    Promise.resolve(subject);

  describe('issueSession', () => {
    it('returns an access token and a refresh token', async () => {
      const session = await service.issueSession(rider);
      expect(session.accessToken).toBe('signed-access-token');
      expect(session.refreshToken).toEqual(expect.any(String));
      expect(session.tokenType).toBe('Bearer');
      expect(session.expiresIn).toBe(3600);
    });

    it('stores the HASH, never the token itself', async () => {
      // A read of this table must not hand an attacker live sessions.
      const session = await service.issueSession(rider);
      expect(repo.rows).toHaveLength(1);
      expect(repo.rows[0].tokenHash).toBe(hashToken(session.refreshToken));
      expect(JSON.stringify(repo.rows[0])).not.toContain(session.refreshToken);
    });

    it('emits the driver claim only for drivers', async () => {
      // AuthResolverService branches on `type === 'driver'`; dropping it would
      // resolve a driver id against the users table.
      await service.issueSession(driver);
      expect(sign).toHaveBeenCalledWith({
        sub: 'driver-1',
        role: Role.DRIVER,
        type: 'driver',
      });

      sign.mockClear();
      await service.issueSession(rider);
      expect(sign).toHaveBeenCalledWith({ sub: 'user-1', role: Role.USER });
    });

    it('gives every sign-in its own family', async () => {
      await service.issueSession(rider);
      await service.issueSession(rider);
      expect(repo.rows[0].familyId).not.toBe(repo.rows[1].familyId);
    });

    it('never issues the same refresh token twice', async () => {
      const seen = new Set<string>();
      for (let i = 0; i < 50; i += 1) {
        seen.add((await service.issueSession(rider)).refreshToken);
      }
      expect(seen.size).toBe(50);
    });

    it('records the client context for the audit trail', async () => {
      await service.issueSession(rider, {
        userAgent: 'ArkRides/1.0',
        ipAddress: '10.0.0.1',
      });
      expect(repo.rows[0].userAgent).toBe('ArkRides/1.0');
      expect(repo.rows[0].ipAddress).toBe('10.0.0.1');
    });

    it('truncates an over-long user agent rather than failing the write', async () => {
      await service.issueSession(rider, { userAgent: 'x'.repeat(1000) });
      expect(repo.rows[0].userAgent).toHaveLength(255);
    });

    it('sets an expiry roughly 30 days out', async () => {
      await service.issueSession(rider);
      const days =
        (repo.rows[0].expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      expect(days).toBeGreaterThan(29.9);
      expect(days).toBeLessThan(30.1);
    });
  });

  describe('rotate', () => {
    it('issues a new pair and consumes the presented token', async () => {
      const first = await service.issueSession(rider);
      const second = await service.rotate(
        first.refreshToken,
        alwaysResolve(rider),
      );

      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(repo.rows[0].revokedAt).toBeInstanceOf(Date);
      expect(repo.rows[0].revokedReason).toBe('rotated');
      expect(repo.rows[1].revokedAt).toBeUndefined();
    });

    it('keeps the rotated token in the same family', async () => {
      const first = await service.issueSession(rider);
      await service.rotate(first.refreshToken, alwaysResolve(rider));
      expect(repo.rows[1].familyId).toBe(repo.rows[0].familyId);
    });

    it('rejects a token it has never seen', async () => {
      await expect(
        service.rotate('never-issued', alwaysResolve(rider)),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an expired token', async () => {
      const first = await service.issueSession(rider);
      repo.rows[0].expiresAt = new Date(Date.now() - 1000);
      await expect(
        service.rotate(first.refreshToken, alwaysResolve(rider)),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('gives the same message for unknown, expired and consumed tokens', async () => {
      // Distinguishing them tells a caller whether a token ever existed.
      const first = await service.issueSession(rider);
      await service.rotate(first.refreshToken, alwaysResolve(rider));

      const messages: string[] = [];
      for (const token of ['never-issued', first.refreshToken]) {
        try {
          await service.rotate(token, alwaysResolve(rider));
        } catch (error) {
          messages.push((error as Error).message);
        }
      }
      expect(new Set(messages).size).toBe(1);
      expect(messages[0]).toBe('Invalid or expired session.');
    });

    describe('reuse detection', () => {
      it('revokes the WHOLE family when a consumed token is replayed', async () => {
        // The theft scenario: attacker steals refresh token R1 and uses it.
        // The real client then presents R1 too. Two parties hold one token and
        // there is no way to tell which is which, so both are signed out.
        const first = await service.issueSession(rider);
        const second = await service.rotate(
          first.refreshToken,
          alwaysResolve(rider),
        );
        const third = await service.rotate(
          second.refreshToken,
          alwaysResolve(rider),
        );

        // The victim replays an old one.
        await expect(
          service.rotate(first.refreshToken, alwaysResolve(rider)),
        ).rejects.toThrow(UnauthorizedException);

        // Every token in the family is now dead, including the live one the
        // thief is holding.
        expect(repo.rows.every((row) => row.revokedAt)).toBe(true);
        await expect(
          service.rotate(third.refreshToken, alwaysResolve(rider)),
        ).rejects.toThrow(UnauthorizedException);
      });

      it('marks the reason so the incident is visible in the table', async () => {
        const first = await service.issueSession(rider);
        const second = await service.rotate(
          first.refreshToken,
          alwaysResolve(rider),
        );
        await expect(
          service.rotate(first.refreshToken, alwaysResolve(rider)),
        ).rejects.toThrow();
        expect(
          repo.rows.find(
            (row) => row.tokenHash === hashToken(second.refreshToken),
          )?.revokedReason,
        ).toBe('reuse-detected');
      });

      it('does not touch an unrelated session', async () => {
        // A compromise of one device must not sign the user out everywhere by
        // accident — only the affected family goes.
        const deviceA = await service.issueSession(rider);
        const deviceB = await service.issueSession(rider);
        await service.rotate(deviceA.refreshToken, alwaysResolve(rider));
        await expect(
          service.rotate(deviceA.refreshToken, alwaysResolve(rider)),
        ).rejects.toThrow();

        await expect(
          service.rotate(deviceB.refreshToken, alwaysResolve(rider)),
        ).resolves.toBeDefined();
      });
    });

    describe('concurrency', () => {
      // NOTE ON WHAT THIS FAKE CAN AND CANNOT PROVE.
      //
      // The production path wraps mint + breach-check in a real transaction,
      // so a detected breach ROLLS BACK the freshly minted token. This fake
      // resolves synchronously and does not model rollback, so what the
      // following cases actually pin is the DECISION LOGIC — who is refused,
      // and that the family ends up fully revoked — not the isolation
      // guarantee, which only a real Postgres can demonstrate.
      it('never lets two simultaneous refreshes both succeed', async () => {
        // The TOCTOU this guards: both callers read `revokedAt = null`, both
        // pass the reuse check, both write, and the session FORKS into two
        // live tokens with reuse detection never firing. A thief only has to
        // fire at the same moment as the victim.
        //
        // Two requests carrying the same refresh token at the same instant is
        // indistinguishable from theft, so the answer is that NOBODY keeps the
        // session — not "first one wins", which would hand it to whichever of
        // the thief and the victim was faster. Clients must serialise their
        // refreshes; standard ones do.
        const first = await service.issueSession(rider);

        const results = await Promise.allSettled([
          service.rotate(first.refreshToken, alwaysResolve(rider)),
          service.rotate(first.refreshToken, alwaysResolve(rider)),
        ]);

        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(0);
        expect(results.filter((r) => r.status === 'rejected')).toHaveLength(2);
        // And critically: no live token is left behind.
        expect(repo.rows.every((row) => row.revokedAt)).toBe(true);
      });

      it('revokes the family when a concurrent claim loses', async () => {
        // Losing the race is indistinguishable from a replay, and gets the
        // same answer: both parties are signed out.
        const first = await service.issueSession(rider);
        await Promise.allSettled([
          service.rotate(first.refreshToken, alwaysResolve(rider)),
          service.rotate(first.refreshToken, alwaysResolve(rider)),
        ]);
        expect(repo.rows.every((row) => row.revokedAt)).toBe(true);
      });
    });

    describe('subject re-resolution', () => {
      it('asks the resolver about the subject the token points at', async () => {
        const first = await service.issueSession(driver);
        const resolver = jest.fn(() => Promise.resolve(driver));
        await service.rotate(first.refreshToken, resolver);
        expect(resolver).toHaveBeenCalledWith('driver-1', Role.DRIVER);
      });

      it('refuses and kills the family when the subject is gone or blocked', async () => {
        // This is what makes a suspension bite within the hour rather than
        // after the 30-day refresh window.
        const first = await service.issueSession(rider);
        await expect(
          service.rotate(first.refreshToken, () => Promise.resolve(null)),
        ).rejects.toThrow(UnauthorizedException);
        // The presented token is consumed either way, and no new one is minted.
        expect(repo.rows[0].revokedAt).toBeInstanceOf(Date);
        expect(repo.rows).toHaveLength(1);
      });

      it('leaves nothing spendable when the subject is gone', async () => {
        const first = await service.issueSession(rider);
        const second = await service.rotate(
          first.refreshToken,
          alwaysResolve(rider),
        );
        await expect(
          service.rotate(second.refreshToken, () => Promise.resolve(null)),
        ).rejects.toThrow(UnauthorizedException);
        expect(repo.rows.every((row) => row.revokedAt)).toBe(true);
      });
    });
  });

  describe('revokeByToken', () => {
    it('ends the session', async () => {
      const first = await service.issueSession(rider);
      await service.revokeByToken(first.refreshToken);
      await expect(
        service.rotate(first.refreshToken, alwaysResolve(rider)),
      ).rejects.toThrow(UnauthorizedException);
      expect(repo.rows[0].revokedReason).toBe('logout');
    });

    it('ends every rotation of that session, not just the newest', async () => {
      const first = await service.issueSession(rider);
      const second = await service.rotate(
        first.refreshToken,
        alwaysResolve(rider),
      );
      await service.revokeByToken(second.refreshToken);
      expect(repo.rows.every((row) => row.revokedAt)).toBe(true);
    });

    it('is silent for an unknown token', async () => {
      await expect(service.revokeByToken('nope')).resolves.toBeUndefined();
    });

    it('is idempotent', async () => {
      const first = await service.issueSession(rider);
      await service.revokeByToken(first.refreshToken);
      await expect(
        service.revokeByToken(first.refreshToken),
      ).resolves.toBeUndefined();
      // Crucially it does NOT re-run as reuse detection and change the reason.
      expect(repo.rows[0].revokedReason).toBe('logout');
    });

    it('a logged-out token presented to refresh is a 401, NOT a breach', async () => {
      // Retrying after a dropped logout response is not an attack, and
      // recording it as one would overwrite the audit reason so that a normal
      // logout looked like a compromise.
      const first = await service.issueSession(rider);
      await service.revokeByToken(first.refreshToken);
      await expect(
        service.rotate(first.refreshToken, alwaysResolve(rider)),
      ).rejects.toThrow(UnauthorizedException);
      expect(repo.rows[0].revokedReason).toBe('logout');
    });
  });

  describe('revokeAllForSubject', () => {
    it('ends every session for one account across devices', async () => {
      await service.issueSession(rider);
      await service.issueSession(rider);
      await service.revokeAllForSubject('user-1', Role.USER);
      expect(repo.rows.every((row) => row.revokedAt)).toBe(true);
    });

    it('leaves a driver row alone when revoking the rider with the same id', async () => {
      // Separate id spaces: a shared id must not cross-revoke.
      await service.issueSession({
        id: 'shared',
        role: Role.USER,
        isDriver: false,
      });
      await service.issueSession({
        id: 'shared',
        role: Role.DRIVER,
        isDriver: true,
      });
      await service.revokeAllForSubject('shared', Role.USER);
      expect(repo.rows[0].revokedAt).toBeInstanceOf(Date);
      expect(repo.rows[1].revokedAt).toBeUndefined();
    });
  });

  describe('hashToken', () => {
    it('is stable and 64 hex characters', () => {
      expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
      expect(hashToken('abc')).toBe(hashToken('abc'));
    });

    it('differs for different inputs', () => {
      expect(hashToken('abc')).not.toBe(hashToken('abd'));
    });
  });
});
