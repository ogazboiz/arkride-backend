import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrivyAuthService } from './privy/privy-auth.service';
import { PrivyAudienceDto } from './dto/privy-auth.dto';

describe('AuthController', () => {
  let controller: AuthController;

  const mockAuthService = {
    register: jest.fn(),
    login: jest.fn(),
    verifyOtp: jest.fn(),
    resendOtp: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
    authenticateWithDecane: jest.fn(),
    refreshSession: jest.fn(),
    logout: jest.fn(),
  };

  const mockPrivyAuthService = { signIn: jest.fn() };

  /** A minimal Express request stand-in for the header/ip reads. */
  const request = (headers: Record<string, string> = {}, ip = '1.2.3.4') =>
    ({
      header: (name: string) => headers[name.toLowerCase()],
      ip,
    }) as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: PrivyAuthService,
          useValue: mockPrivyAuthService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('is constructible', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /auth/privy', () => {
    it('forwards the tokens, audience and client context to the service', async () => {
      mockPrivyAuthService.signIn.mockResolvedValue({ accessToken: 'a' });

      await controller.privySignIn(
        {
          accessToken: 'privy-access',
          identityToken: 'privy-identity',
          audience: PrivyAudienceDto.RIDER,
          name: 'Amina',
          email: 'amina@example.com',
        },
        request({ 'user-agent': 'ArkRides/1.0' }),
      );

      expect(mockPrivyAuthService.signIn).toHaveBeenCalledWith({
        accessToken: 'privy-access',
        identityToken: 'privy-identity',
        audience: 'rider',
        name: 'Amina',
        email: 'amina@example.com',
        userAgent: 'ArkRides/1.0',
        ipAddress: '1.2.3.4',
      });
    });

    it('falls back to the privy-id-token header when the body omits it', async () => {
      // Privy's web SDK sets the header; React Native does not send one.
      // Accepting both is why this fallback exists.
      mockPrivyAuthService.signIn.mockResolvedValue({});

      await controller.privySignIn(
        { accessToken: 'privy-access', audience: PrivyAudienceDto.DRIVER },
        request({ 'privy-id-token': 'from-header' }),
      );

      expect(mockPrivyAuthService.signIn).toHaveBeenCalledWith(
        expect.objectContaining({ identityToken: 'from-header', audience: 'driver' }),
      );
    });

    it('passes null rather than undefined when there is no identity token at all', async () => {
      mockPrivyAuthService.signIn.mockResolvedValue({});

      await controller.privySignIn(
        { accessToken: 'privy-access', audience: PrivyAudienceDto.RIDER },
        request(),
      );

      expect(mockPrivyAuthService.signIn).toHaveBeenCalledWith(
        expect.objectContaining({ identityToken: null }),
      );
    });

    it('prefers the body token over the header when both are present', async () => {
      mockPrivyAuthService.signIn.mockResolvedValue({});

      await controller.privySignIn(
        {
          accessToken: 'privy-access',
          identityToken: 'from-body',
          audience: PrivyAudienceDto.RIDER,
        },
        request({ 'privy-id-token': 'from-header' }),
      );

      expect(mockPrivyAuthService.signIn).toHaveBeenCalledWith(
        expect.objectContaining({ identityToken: 'from-body' }),
      );
    });
  });

  describe('POST /auth/refresh', () => {
    it('forwards the refresh token and client context', async () => {
      mockAuthService.refreshSession.mockResolvedValue({ accessToken: 'new' });

      const result = await controller.refresh(
        { refreshToken: 'r1' },
        request({ 'user-agent': 'ArkRides/1.0' }),
      );

      expect(mockAuthService.refreshSession).toHaveBeenCalledWith('r1', {
        userAgent: 'ArkRides/1.0',
        ipAddress: '1.2.3.4',
      });
      expect(result).toEqual({ accessToken: 'new' });
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the session and returns no body', async () => {
      mockAuthService.logout.mockResolvedValue(undefined);
      await expect(controller.logout({ refreshToken: 'r1' })).resolves.toBeUndefined();
      expect(mockAuthService.logout).toHaveBeenCalledWith('r1');
    });
  });
});
