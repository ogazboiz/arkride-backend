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
        },
        request({ 'user-agent': 'ArkRides/1.0' }),
      );

      expect(mockPrivyAuthService.signIn).toHaveBeenCalledWith({
        accessToken: 'privy-access',
        identityToken: 'privy-identity',
        audience: 'rider',
        name: 'Amina',
        userAgent: 'ArkRides/1.0',
        ipAddress: '1.2.3.4',
      });
    });

    it('does NOT forward an email, even one smuggled past the DTO', async () => {
      // The account takeover: the address used to link a Privy DID to an
      // existing account came from this body, so anyone with their own valid
      // Privy token could name a victim's address and be handed their account.
      //
      // `email` is gone from PrivySignInDto and from PrivySignInInput. This
      // pins the CONTROLLER's half of that — it enumerates fields rather than
      // spreading `dto`, so a stray property cannot ride through even if
      // validation were somehow bypassed.
      mockPrivyAuthService.signIn.mockResolvedValue({});

      await controller.privySignIn(
        {
          accessToken: 'privy-access',
          audience: PrivyAudienceDto.RIDER,
          email: 'victim@example.com',
        } as never,
        request(),
      );

      const forwarded = mockPrivyAuthService.signIn.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(forwarded).not.toHaveProperty('email');
      expect(JSON.stringify(forwarded)).not.toContain('victim@example.com');
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
