import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrivyAuthService } from './privy/privy-auth.service';
import { PRIVY_IDENTITY_HEADER } from './privy/privy.service';
import {
  PrivySignInDto,
  PrivyDriverRegisterDto,
  RefreshSessionDto,
} from './dto/privy-auth.dto';
import type { Request } from 'express';
import { RegisterDto } from './dto/register.dto';
// import { GoogleAuthDto } from './dto/google-auth.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('Auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly privyAuthService: PrivyAuthService,
  ) {}

  @Throttle({
    short: { limit: 3, ttl: 1_000 },
    medium: { limit: 5, ttl: 60_000 },
  })
  @Post('register')
  @ApiOperation({ summary: 'Register a new user account' })
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({
    description: 'Registration successful. OTP sent for verification.',
  })
  @ApiBadRequestResponse({ description: 'Invalid registration payload.' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Throttle({
    short: { limit: 3, ttl: 1_000 },
    medium: { limit: 5, ttl: 60_000 },
  })
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify account with OTP' })
  @ApiBody({ type: VerifyOtpDto })
  @ApiOkResponse({ description: 'OTP verified successfully.' })
  @ApiBadRequestResponse({ description: 'Invalid or expired OTP.' })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Throttle({
    short: { limit: 3, ttl: 1_000 },
    medium: { limit: 5, ttl: 60_000 },
  })
  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend account verification OTP' })
  @ApiBody({ type: ResendOtpDto })
  @ApiOkResponse({ description: 'OTP resent successfully.' })
  @ApiBadRequestResponse({
    description: 'Unable to resend OTP for the supplied email.',
  })
  async resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto);
  }

  @Post('login')
  @ApiOperation({ summary: 'Sign in with email and password' })
  @HttpCode(HttpStatus.OK)
  // Credential endpoint: a much tighter burst clamp than the app-wide one.
  // 5 attempts per minute, and 3 per second, per IP. The `short` and `medium`
  // names must match SecurityModule's throttlers — an override naming a
  // throttler that does not exist is silently ignored, which is what the
  // previous `{ short: ... }` was doing against a config that defined none.
  @Throttle({
    short: { limit: 3, ttl: 1_000 },
    medium: { limit: 5, ttl: 60_000 },
  })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Throttle({
    short: { limit: 3, ttl: 1_000 },
    medium: { limit: 5, ttl: 60_000 },
  })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset OTP' })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiOkResponse({ description: 'Password reset OTP sent.' })
  @ApiBadRequestResponse({ description: 'Invalid email address.' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Throttle({
    short: { limit: 3, ttl: 1_000 },
    medium: { limit: 5, ttl: 60_000 },
  })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using OTP' })
  @ApiBody({ type: ResetPasswordDto })
  @ApiOkResponse({ description: 'Password reset successful.' })
  @ApiBadRequestResponse({ description: 'Invalid reset payload or OTP.' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  /**
   * Sign in with Privy.
   *
   * Ark Rides shares one Privy application with the rest of WorldStreet, so a
   * rider who already has a WorldStreet identity signs in with it here.
   *
   * The client presents Privy's ACCESS token (who they are) and, optionally,
   * its IDENTITY token (what wallet they hold). Both are verified server-side
   * against the app's public key — the wallet in particular must never come
   * from a plain header, because this API is public and a header would let
   * anyone claim any address.
   *
   * Returns an Ark Rides session, not a Privy one: every guard, role and the
   * websocket handshake already speak the internal token, and exchanging once
   * at the door is far less surface than teaching all of them a second
   * credential format.
   */
  @Throttle({
    short: { limit: 3, ttl: 1_000 },
    medium: { limit: 10, ttl: 60_000 },
  })
  @Post('privy')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with a Privy access token' })
  @ApiBody({ type: PrivySignInDto })
  @ApiOkResponse({ description: 'Session issued.' })
  async privySignIn(@Body() dto: PrivySignInDto, @Req() req: Request) {
    return this.privyAuthService.signIn({
      accessToken: dto.accessToken,
      // Accepted in the body OR the standard header, because Privy's own web
      // SDK sets the header and its React Native SDK does not.
      identityToken:
        dto.identityToken ?? req.header(PRIVY_IDENTITY_HEADER) ?? null,
      audience: dto.audience,
      name: dto.name,
      userAgent: req.header('user-agent') ?? null,
      ipAddress: req.ip ?? null,
    });
  }

  /**
   * Provision a new driver from a verified Privy identity + collected details.
   *
   * Sign-in (`POST /auth/privy` with audience "driver") refuses an unknown DID
   * with `code: DRIVER_NOT_REGISTERED`; the driver app then collects licence
   * and vehicle details and calls this to create the account. Idempotent: an
   * already-linked driver is simply signed in.
   */
  @Throttle({
    short: { limit: 3, ttl: 1_000 },
    medium: { limit: 10, ttl: 60_000 },
  })
  @Post('privy/driver-register')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Register a driver with a Privy access token' })
  @ApiBody({ type: PrivyDriverRegisterDto })
  @ApiOkResponse({ description: 'Driver provisioned and session issued.' })
  async privyDriverRegister(
    @Body() dto: PrivyDriverRegisterDto,
    @Req() req: Request,
  ) {
    return this.privyAuthService.registerDriver(
      {
        accessToken: dto.accessToken,
        identityToken:
          dto.identityToken ?? req.header(PRIVY_IDENTITY_HEADER) ?? null,
        audience: 'driver',
        userAgent: req.header('user-agent') ?? null,
        ipAddress: req.ip ?? null,
      },
      {
        name: dto.name,
        phone: dto.phone,
        licenseNumber: dto.licenseNumber,
        licenseExpiry: dto.licenseExpiry,
        vehicleType: dto.vehicleType,
        plateNumber: dto.plateNumber,
        vehicleColor: dto.vehicleColor,
        vehicleModel: dto.vehicleModel,
        vehicleYear: dto.vehicleYear,
      },
    );
  }

  /**
   * Exchange a refresh token for a new session.
   *
   * The presented token is CONSUMED — every refresh rotates. See
   * RefreshToken for what happens when an already-consumed token turns up.
   */
  @Throttle({
    short: { limit: 3, ttl: 1_000 },
    medium: { limit: 30, ttl: 60_000 },
  })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a refresh token for a new session' })
  @ApiBody({ type: RefreshSessionDto })
  @ApiOkResponse({ description: 'New session issued.' })
  async refresh(@Body() dto: RefreshSessionDto, @Req() req: Request) {
    return this.authService.refreshSession(dto.refreshToken, {
      userAgent: req.header('user-agent') ?? null,
      ipAddress: req.ip ?? null,
    });
  }

  /**
   * End a session.
   *
   * There was no logout at all before this — access tokens lasted seven days
   * with no jti and no denylist, so nothing could end a session early.
   * Deliberately idempotent and unauthenticated: it takes the refresh token
   * itself as proof, so a client whose access token has already expired can
   * still sign out.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a session' })
  @ApiNoContentResponse({ description: 'Session revoked. No body.' })
  @ApiBody({ type: RefreshSessionDto })
  async logout(@Body() dto: RefreshSessionDto): Promise<void> {
    await this.authService.logout(dto.refreshToken);
  }

  //   @Post('google')
  //   @HttpCode(HttpStatus.OK)
  //   async googleAuth(@Body() dto: GoogleAuthDto) {
  //     return this.authService.googleAuth(dto);
  //   }
}
