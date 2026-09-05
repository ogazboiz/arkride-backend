import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrivyAuthService } from './privy-auth.service';
import { PrivyService } from './privy.service';
import { TokenService } from '../services/token.service';
import { User } from '../../users/entities/user.entity';
import { Driver } from '../../drivers/entities/driver.entity';
import { Role } from '../../common/enums/role.enum';

const DID = 'did:privy:cm0000000000000000000000';
const OTHER_DID = 'did:privy:cm1111111111111111111111';
const WALLET = '0xabcdef0123456789abcdef0123456789abcdef01';

/** Minimal in-memory repository, matching only what the service calls. */
function fakeRepo<T extends { id: string }>(seed: T[] = []) {
  const rows = [...seed];
  return {
    rows,
    findOne: jest.fn(({ where }: any) =>
      Promise.resolve(
        rows.find((row) =>
          Object.entries(where).every(([k, v]) => (row as any)[k] === v),
        ) ?? null,
      ),
    ),
    create: jest.fn((data: Partial<T>) => ({ id: 'new-id', ...data }) as T),
    save: jest.fn((row: T) => {
      const index = rows.findIndex((existing) => existing.id === row.id);
      if (index >= 0) rows[index] = row;
      else rows.push(row);
      return Promise.resolve(row);
    }),
  };
}

describe('PrivyAuthService', () => {
  let service: PrivyAuthService;
  let users: ReturnType<typeof fakeRepo<any>>;
  let drivers: ReturnType<typeof fakeRepo<any>>;
  let privy: { isConfigured: boolean; verifyAccessToken: jest.Mock; walletFromIdentityToken: jest.Mock };
  let tokens: { issueSession: jest.Mock };

  async function build(
    seedUsers: any[] = [],
    seedDrivers: any[] = [],
  ): Promise<void> {
    users = fakeRepo(seedUsers);
    drivers = fakeRepo(seedDrivers);
    privy = {
      isConfigured: true,
      verifyAccessToken: jest.fn().mockResolvedValue(DID),
      walletFromIdentityToken: jest.fn().mockResolvedValue(null),
    };
    tokens = {
      issueSession: jest.fn().mockResolvedValue({
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresIn: 3600,
        tokenType: 'Bearer',
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrivyAuthService,
        { provide: PrivyService, useValue: privy },
        { provide: TokenService, useValue: tokens },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(Driver), useValue: drivers },
      ],
    }).compile();

    service = moduleRef.get(PrivyAuthService);
  }

  const riderSignIn = (over: Record<string, unknown> = {}) =>
    service.signIn({ accessToken: 'tok', audience: 'rider', ...over } as any);
  const driverSignIn = (over: Record<string, unknown> = {}) =>
    service.signIn({ accessToken: 'tok', audience: 'driver', ...over } as any);

  beforeEach(() => build());

  describe('preconditions', () => {
    it('reports a configuration problem as 503, not as a bad token', async () => {
      // Reporting this as 401 sends the client debugging a token that is fine.
      await build();
      privy.isConfigured = false;
      await expect(riderSignIn()).rejects.toThrow(ServiceUnavailableException);
    });

    it('rejects an unverifiable Privy token', async () => {
      privy.verifyAccessToken.mockResolvedValue(null);
      await expect(riderSignIn()).rejects.toThrow(UnauthorizedException);
    });

    it('never issues a session when the token does not verify', async () => {
      privy.verifyAccessToken.mockResolvedValue(null);
      await expect(riderSignIn()).rejects.toThrow();
      expect(tokens.issueSession).not.toHaveBeenCalled();
    });
  });

  describe('riders are provisioned on first sign-in', () => {
    it('creates a rider for an unknown DID', async () => {
      const result = await riderSignIn({ name: 'Amina', email: 'Amina@Example.com' });

      expect(result.isNewAccount).toBe(true);
      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({
          privyDid: DID,
          name: 'Amina',
          email: 'amina@example.com',
          isVerified: true,
          role: Role.USER,
          password: null,
        }),
      );
    });

    it('marks a Privy rider verified — our OTP adds nothing to it', async () => {
      await riderSignIn();
      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({ isVerified: true }),
      );
    });

    it('synthesises a unique placeholder email when Privy has none', async () => {
      // Phone-only and wallet-only Privy accounts have no email, but the
      // column is NOT NULL and unique. Keying the placeholder on the DID means
      // it cannot collide, and cannot look like a real address either.
      await riderSignIn();
      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: `${DID}@privy.arkrides.local` }),
      );
    });

    it('signs an existing linked rider in without creating a second row', async () => {
      await build([
        { id: 'user-1', privyDid: DID, name: 'Amina', email: 'a@b.com', isBlocked: false },
      ]);
      const result = await riderSignIn();
      expect(result.isNewAccount).toBe(false);
      expect(result.profile.id).toBe('user-1');
      expect(users.create).not.toHaveBeenCalled();
    });

    it('refuses a blocked rider', async () => {
      await build([
        { id: 'user-1', privyDid: DID, name: 'A', email: 'a@b.com', isBlocked: true },
      ]);
      await expect(riderSignIn()).rejects.toThrow(ForbiddenException);
      expect(tokens.issueSession).not.toHaveBeenCalled();
    });
  });

  describe('linking an existing password account', () => {
    it('links by verified email rather than creating a colliding row', async () => {
      // `users.email` is unique, so creating a second row would fail anyway —
      // and this is the same person, who just signed in a different way.
      await build([
        { id: 'user-1', privyDid: null, name: 'Amina', email: 'a@b.com', isBlocked: false },
      ]);
      const result = await riderSignIn({ email: 'a@b.com' });

      expect(result.isNewAccount).toBe(false);
      expect(result.profile.id).toBe('user-1');
      expect(users.rows[0].privyDid).toBe(DID);
    });

    it('refuses to re-point an account already linked to a DIFFERENT DID', async () => {
      // This is the shape an account-takeover attempt has.
      await build([
        { id: 'user-1', privyDid: OTHER_DID, name: 'A', email: 'a@b.com', isBlocked: false },
      ]);
      await expect(riderSignIn({ email: 'a@b.com' })).rejects.toThrow(
        ForbiddenException,
      );
      expect(users.rows[0].privyDid).toBe(OTHER_DID);
    });

    it('matches the email case-insensitively', async () => {
      await build([
        { id: 'user-1', privyDid: null, name: 'A', email: 'a@b.com', isBlocked: false },
      ]);
      await riderSignIn({ email: 'A@B.COM' });
      expect(users.rows[0].privyDid).toBe(DID);
    });
  });

  describe('wallet capture', () => {
    it('records the embedded wallet from the identity token', async () => {
      privy.walletFromIdentityToken.mockResolvedValue(WALLET);
      const result = await riderSignIn({ identityToken: 'id-tok' });
      expect(result.profile.walletAddressEvm).toBe(WALLET);
    });

    it('signs in fine when no identity token is supplied', async () => {
      // A missing or stale identity token must never block sign-in — it only
      // means we do not learn the wallet this time.
      const result = await riderSignIn();
      expect(result.profile.walletAddressEvm).toBeUndefined();
      expect(tokens.issueSession).toHaveBeenCalled();
    });

    it('updates a wallet that has changed', async () => {
      await build([
        {
          id: 'user-1',
          privyDid: DID,
          name: 'A',
          email: 'a@b.com',
          isBlocked: false,
          walletAddressEvm: '0x1111111111111111111111111111111111111111',
        },
      ]);
      privy.walletFromIdentityToken.mockResolvedValue(WALLET);
      await riderSignIn({ identityToken: 'id-tok' });
      expect(users.rows[0].walletAddressEvm).toBe(WALLET);
    });

    it('does NOT erase a stored wallet when the token carries none', async () => {
      // A sign-in from a session without an embedded wallet must not wipe an
      // address that money may already be routed to.
      await build([
        {
          id: 'user-1',
          privyDid: DID,
          name: 'A',
          email: 'a@b.com',
          isBlocked: false,
          walletAddressEvm: WALLET,
        },
      ]);
      privy.walletFromIdentityToken.mockResolvedValue(null);
      await riderSignIn();
      expect(users.rows[0].walletAddressEvm).toBe(WALLET);
    });
  });

  describe('drivers are NOT provisioned', () => {
    it('refuses an unknown DID asking for a driver session', async () => {
      // Driving needs a licence, a vehicle and an admin approval. Minting a
      // driver from a social login would create an unverified one.
      await expect(driverSignIn()).rejects.toThrow(BadRequestException);
      expect(drivers.create).not.toHaveBeenCalled();
    });

    it('signs in a linked driver', async () => {
      await build([], [
        {
          id: 'driver-1',
          privyDid: DID,
          name: 'Yusuf',
          email: 'y@b.com',
          isActive: true,
          verificationStatus: 'approved',
        },
      ]);
      const result = await driverSignIn();
      expect(result.profile.role).toBe(Role.DRIVER);
      expect(tokens.issueSession).toHaveBeenCalledWith(
        { id: 'driver-1', role: Role.DRIVER, isDriver: true },
        expect.anything(),
      );
    });

    it('links an existing driver by email', async () => {
      await build([], [
        {
          id: 'driver-1',
          privyDid: null,
          name: 'Y',
          email: 'y@b.com',
          isActive: true,
          verificationStatus: 'pending',
        },
      ]);
      await driverSignIn({ email: 'y@b.com' });
      expect(drivers.rows[0].privyDid).toBe(DID);
    });

    it('refuses a deactivated driver', async () => {
      await build([], [
        { id: 'driver-1', privyDid: DID, name: 'Y', email: 'y@b.com', isActive: false },
      ]);
      await expect(driverSignIn()).rejects.toThrow(ForbiddenException);
    });
  });

  describe('audience separation', () => {
    it('does not fall back to the drivers table for a rider request', async () => {
      // Guessing which table a DID belongs to breaks exactly for the people
      // who are both a rider and a driver. The client states which it wants.
      await build([], [
        { id: 'driver-1', privyDid: DID, name: 'Y', email: 'y@b.com', isActive: true },
      ]);
      const result = await riderSignIn();
      expect(result.profile.role).toBe(Role.USER);
      expect(result.isNewAccount).toBe(true);
    });

    it('does not fall back to the users table for a driver request', async () => {
      await build([
        { id: 'user-1', privyDid: DID, name: 'A', email: 'a@b.com', isBlocked: false },
      ]);
      await expect(driverSignIn()).rejects.toThrow(BadRequestException);
    });

    it('lets one DID hold both a rider and a driver session', async () => {
      await build(
        [{ id: 'user-1', privyDid: DID, name: 'A', email: 'a@b.com', isBlocked: false }],
        [{ id: 'driver-1', privyDid: DID, name: 'A', email: 'd@b.com', isActive: true }],
      );
      expect((await riderSignIn()).profile.id).toBe('user-1');
      expect((await driverSignIn()).profile.id).toBe('driver-1');
    });
  });
});
