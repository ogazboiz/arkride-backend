import { UnauthorizedException } from '@nestjs/common';
import {
  AuthResolverService,
  stripCredentials,
} from './auth-resolver.service';
import { Role } from '../../common/enums/role.enum';

/**
 * These cases moved here from jwt.strategy.spec.ts when the resolution logic
 * was extracted, so the websocket gateway and the HTTP strategy could share it.
 * The behaviour under test is unchanged — riders and drivers live in separate
 * tables and a token must never be resolved against the wrong one.
 */
describe('AuthResolverService', () => {
  let resolver: AuthResolverService;
  let usersService: { findById: jest.Mock };
  let driversService: { findForAuth: jest.Mock };

  beforeEach(() => {
    usersService = { findById: jest.fn() };
    driversService = { findForAuth: jest.fn() };

    resolver = new AuthResolverService(
      usersService as any,
      driversService as any,
    );
  });

  it('validates a driver token against the drivers table', async () => {
    const driver = {
      id: 'driver-id',
      email: 'driver@example.com',
      role: Role.DRIVER,
    };
    driversService.findForAuth.mockResolvedValue(driver);

    await expect(
      resolver.resolvePrincipal({
        sub: 'driver-id',
        email: 'driver@example.com',
        role: Role.DRIVER,
        type: 'driver',
      }),
    ).resolves.toEqual(driver);

    expect(driversService.findForAuth).toHaveBeenCalledWith('driver-id');
    expect(usersService.findById).not.toHaveBeenCalled();
  });

  it('rejects a driver token when the driver cannot be resolved', async () => {
    driversService.findForAuth.mockResolvedValue(null);

    await expect(
      resolver.resolvePrincipal({
        sub: 'driver-id',
        email: 'driver@example.com',
        role: Role.DRIVER,
        type: 'driver',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('does not treat a user token with driver role as a driver token', async () => {
    usersService.findById.mockResolvedValue(null);

    await expect(
      resolver.resolvePrincipal({
        sub: 'user-id',
        email: 'user@example.com',
        role: Role.DRIVER,
        type: 'user',
      }),
    ).rejects.toThrow(UnauthorizedException);

    expect(driversService.findForAuth).not.toHaveBeenCalled();
    expect(usersService.findById).toHaveBeenCalledWith('user-id');
  });

  it('rejects a token with no subject', async () => {
    await expect(resolver.resolvePrincipal({ role: Role.USER })).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('AuthResolverService — privilege and credential hardening', () => {

  describe('the role comes from the database, not the token', () => {
    let resolver: AuthResolverService;
    let usersService: { findById: jest.Mock };
    let driversService: { findForAuth: jest.Mock };

    beforeEach(() => {
      usersService = { findById: jest.fn() };
      driversService = { findForAuth: jest.fn() };
      resolver = new AuthResolverService(
        usersService as any,
        driversService as any,
      );
    });

    it('IGNORES role: admin in the token when the row says otherwise', async () => {
      // This used to `return { ...user, role: Role.ADMIN }` on the strength of
      // the claim alone. Demoting an admin in the database therefore did
      // nothing for the full lifetime of their access token.
      usersService.findById.mockResolvedValue({
        id: 'user-1',
        email: 'a@b.com',
        role: Role.USER,
        isBlocked: false,
      });

      const principal = await resolver.resolvePrincipal({
        sub: 'user-1',
        role: Role.ADMIN,
      });

      expect(principal.role).toBe(Role.USER);
    });

    it('grants admin when the DATABASE says admin, whatever the token claims', async () => {
      usersService.findById.mockResolvedValue({
        id: 'admin-1',
        email: 'a@b.com',
        role: Role.ADMIN,
        isBlocked: false,
      });

      const principal = await resolver.resolvePrincipal({
        sub: 'admin-1',
        role: Role.USER,
      });

      expect(principal.role).toBe(Role.ADMIN);
    });

    it('refuses a blocked rider', async () => {
      // The drivers branch already refused deactivated drivers; riders had no
      // equivalent, so a blocked rider kept full access until their token
      // expired.
      usersService.findById.mockResolvedValue({
        id: 'user-1',
        role: Role.USER,
        isBlocked: true,
      });

      await expect(
        resolver.resolvePrincipal({ sub: 'user-1', role: Role.USER }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('never puts the password hash on the principal', async () => {
      usersService.findById.mockResolvedValue({
        id: 'user-1',
        role: Role.USER,
        isBlocked: false,
        password: '$2b$10$hashhashhash',
        otpCode: '123456',
      });

      const principal = await resolver.resolvePrincipal({ sub: 'user-1' });
      expect(principal).not.toHaveProperty('password');
      expect(principal).not.toHaveProperty('otpCode');
    });

    it('still uses `type` to pick the TABLE, which is not a permission', async () => {
      // users and drivers have separate id spaces, so the token has to say
      // which one to look in. That part is legitimate.
      driversService.findForAuth.mockResolvedValue({
        id: 'shared-id',
        role: Role.DRIVER,
        isActive: true,
      });

      await resolver.resolvePrincipal({ sub: 'shared-id', type: 'driver' });
      expect(driversService.findForAuth).toHaveBeenCalledWith('shared-id');
      expect(usersService.findById).not.toHaveBeenCalled();
    });
  });

  describe('stripCredentials', () => {
    it('removes the password hash, OTP code and OTP expiry', () => {
      // `{ ...user }` used to put all three on req.user for every
      // authenticated request, and @CurrentUser() hands that object to every
      // controller.
      const safe = stripCredentials({
        id: 'user-1',
        name: 'Amina',
        email: 'a@b.com',
        password: '$2b$10$hashhashhash',
        otpCode: '123456',
        otpExpiry: new Date(),
        role: 'user',
      });

      expect(safe).not.toHaveProperty('password');
      expect(safe).not.toHaveProperty('otpCode');
      expect(safe).not.toHaveProperty('otpExpiry');
      expect(JSON.stringify(safe)).not.toContain('$2b$10$');
    });

    it('keeps everything a controller legitimately reads', () => {
      const safe = stripCredentials({
        id: 'user-1',
        name: 'Amina',
        email: 'a@b.com',
        role: 'user',
        walletAddressEvm: '0xabc',
        password: 'x',
      });
      expect(safe).toEqual({
        id: 'user-1',
        name: 'Amina',
        email: 'a@b.com',
        role: 'user',
        walletAddressEvm: '0xabc',
      });
    });

    it('is harmless on an object with none of them', () => {
      expect(stripCredentials({ id: 'x' })).toEqual({ id: 'x' });
    });
  });
});
