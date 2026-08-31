import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { Role } from '../../common/enums/role.enum';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let usersService: { findById: jest.Mock };
  let driversService: { findForAuth: jest.Mock };
  let configService: { get: jest.Mock };
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    usersService = {
      findById: jest.fn(),
    };
    driversService = {
      findForAuth: jest.fn(),
    };
    configService = {
      get: jest.fn().mockReturnValue('test-secret'),
    };
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

    strategy = new JwtStrategy(
      usersService as any,
      driversService as any,
      configService as any,
    );
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('validates a driver token against the drivers table', async () => {
    const driver = {
      id: 'driver-id',
      email: 'driver@example.com',
      role: Role.DRIVER,
    };
    driversService.findForAuth.mockResolvedValue(driver);

    await expect(
      strategy.validate({
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
      strategy.validate({
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
      strategy.validate({
        sub: 'user-id',
        email: 'user@example.com',
        role: Role.DRIVER,
        type: 'user',
      }),
    ).rejects.toThrow(UnauthorizedException);

    expect(driversService.findForAuth).not.toHaveBeenCalled();
    expect(usersService.findById).toHaveBeenCalledWith('user-id');
  });
});
