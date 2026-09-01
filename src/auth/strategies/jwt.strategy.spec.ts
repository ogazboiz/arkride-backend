import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { Role } from '../../common/enums/role.enum';

/**
 * The strategy is now a thin passport wrapper: all identity resolution lives in
 * AuthResolverService (see auth-resolver.service.spec.ts for those cases), so
 * what matters here is that the strategy delegates rather than deciding
 * anything itself — a second implementation is exactly what the extraction
 * was meant to prevent.
 */
describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let authResolver: { resolvePrincipal: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(() => {
    authResolver = { resolvePrincipal: jest.fn() };
    configService = { get: jest.fn().mockReturnValue('test-secret') };

    strategy = new JwtStrategy(authResolver as any, configService as any);
  });

  it('delegates resolution to AuthResolverService', async () => {
    const principal = { id: 'driver-id', role: Role.DRIVER };
    authResolver.resolvePrincipal.mockResolvedValue(principal);

    const payload = { sub: 'driver-id', role: Role.DRIVER, type: 'driver' };

    await expect(strategy.validate(payload)).resolves.toEqual(principal);
    expect(authResolver.resolvePrincipal).toHaveBeenCalledWith(payload);
  });

  it('propagates rejection from the resolver', async () => {
    authResolver.resolvePrincipal.mockRejectedValue(
      new UnauthorizedException('Invalid driver token'),
    );

    await expect(
      strategy.validate({ sub: 'driver-id', role: Role.DRIVER, type: 'driver' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
