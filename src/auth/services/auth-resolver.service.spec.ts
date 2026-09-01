import { UnauthorizedException } from '@nestjs/common';
import { AuthResolverService } from './auth-resolver.service';
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
