import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { EmailService } from '../common/services/email.service';
import { TokenService } from './services/token.service';
import { DriversService } from '../drivers/drivers.service';
import { Role } from '../common/enums/role.enum';

describe('AuthService', () => {
  let service: AuthService;

  const mockUsersService = {
    findByEmail: jest.fn(),
    findByPhone: jest.fn(),
    findById: jest.fn(),
    findByProvider: jest.fn(),
    createUser: jest.fn(),
    updateWalletAddresses: jest.fn(),
  };

  const mockJwtService = { sign: jest.fn(() => 'mock-jwt-token') };

  const mockEmailService = {
    sendOtpEmail: jest.fn(),
    sendWelcomeEmail: jest.fn(),
    sendForgotPasswordEmail: jest.fn(),
  };

  const mockTokenService = {
    rotate: jest.fn(),
    revokeByToken: jest.fn(),
    issueSession: jest.fn(),
  };

  const mockDriversService = { findForAuth: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: TokenService, useValue: mockTokenService },
        { provide: DriversService, useValue: mockDriversService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('is constructible', () => {
    expect(service).toBeDefined();
  });

  describe('refreshSession', () => {
    /**
     * `rotate` takes a resolver callback and calls it with the subject the
     * stored token points at. These tests reach into that callback, because it
     * carries the security-relevant part: whether a blocked or deactivated
     * account can still renew a session.
     */
    async function resolverFor(
      subjectId: string,
      subjectType: Role,
    ): Promise<unknown> {
      let captured: any;
      mockTokenService.rotate.mockImplementation(async (_token, resolve) => {
        captured = await resolve(subjectId, subjectType);
        return { accessToken: 'a', refreshToken: 'r' };
      });
      await service.refreshSession('some-refresh-token');
      return captured;
    }

    it('passes the presented token and context through to the rotator', async () => {
      mockTokenService.rotate.mockResolvedValue({ accessToken: 'a' });
      await service.refreshSession('tok', { ipAddress: '1.2.3.4' });
      expect(mockTokenService.rotate).toHaveBeenCalledWith(
        'tok',
        expect.any(Function),
        { ipAddress: '1.2.3.4' },
      );
    });

    it('resolves an active rider', async () => {
      mockUsersService.findById.mockResolvedValue({
        id: 'user-1',
        role: Role.USER,
        isBlocked: false,
      });
      expect(await resolverFor('user-1', Role.USER)).toEqual({
        id: 'user-1',
        role: Role.USER,
        isDriver: false,
      });
    });

    it('refuses to renew a BLOCKED rider', async () => {
      // The point of re-reading the subject on refresh: a block has to bite
      // within the access-token lifetime, not at the end of the 30-day
      // refresh window.
      mockUsersService.findById.mockResolvedValue({
        id: 'user-1',
        role: Role.USER,
        isBlocked: true,
      });
      expect(await resolverFor('user-1', Role.USER)).toBeNull();
    });

    it('refuses to renew a rider who no longer exists', async () => {
      mockUsersService.findById.mockResolvedValue(null);
      expect(await resolverFor('user-1', Role.USER)).toBeNull();
    });

    it('resolves an active driver and marks the token as a driver token', async () => {
      // `isDriver` becomes the `type: 'driver'` claim AuthResolverService
      // branches on; losing it would resolve a driver id against the users
      // table.
      mockDriversService.findForAuth.mockResolvedValue({
        id: 'driver-1',
        isActive: true,
      });
      expect(await resolverFor('driver-1', Role.DRIVER)).toEqual({
        id: 'driver-1',
        role: Role.DRIVER,
        isDriver: true,
      });
    });

    it('refuses to renew a DEACTIVATED driver', async () => {
      mockDriversService.findForAuth.mockResolvedValue({
        id: 'driver-1',
        isActive: false,
      });
      expect(await resolverFor('driver-1', Role.DRIVER)).toBeNull();
    });

    it('looks a driver up in the drivers table, never the users table', async () => {
      // users and drivers have separate id spaces; crossing them would
      // resolve a driver token to an unrelated rider row.
      mockDriversService.findForAuth.mockResolvedValue({
        id: 'shared-id',
        isActive: true,
      });
      await resolverFor('shared-id', Role.DRIVER);
      expect(mockDriversService.findForAuth).toHaveBeenCalledWith('shared-id');
      expect(mockUsersService.findById).not.toHaveBeenCalled();
    });

    it('propagates the rotator refusing an invalid token', async () => {
      mockTokenService.rotate.mockRejectedValue(
        new UnauthorizedException('Invalid or expired session.'),
      );
      await expect(service.refreshSession('bad')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('revokes the presented token', async () => {
      mockTokenService.revokeByToken.mockResolvedValue(undefined);
      await service.logout('tok');
      expect(mockTokenService.revokeByToken).toHaveBeenCalledWith('tok');
    });

    it('resolves even for an unknown token', async () => {
      // Idempotent by design: logout must not double as a probe for which
      // tokens are real, and a retried logout must not error.
      mockTokenService.revokeByToken.mockResolvedValue(undefined);
      await expect(service.logout('never-existed')).resolves.toBeUndefined();
    });
  });
});
