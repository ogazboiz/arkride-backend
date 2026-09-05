import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service'
import { RegisterDto } from './dto/register.dto';
// import { GoogleAuthDto } from './dto/google-auth.dto';
import { LoginDto } from './dto/login.dto'
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { DecaneAuthDto } from './dto/decane-auth.dto';
import { Throttle } from '@nestjs/throttler';
import { ApiBadRequestResponse, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';


@ApiTags('Auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Throttle({ short: { limit: 3, ttl: 1_000 }, medium: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @ApiOperation({ summary: 'Register a new user account' })
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({ description: 'Registration successful. OTP sent for verification.' })
  @ApiBadRequestResponse({ description: 'Invalid registration payload.' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto)
  }

  @Throttle({ short: { limit: 3, ttl: 1_000 }, medium: { limit: 5, ttl: 60_000 } })
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify account with OTP' })
  @ApiBody({ type: VerifyOtpDto })
  @ApiOkResponse({ description: 'OTP verified successfully.' })
  @ApiBadRequestResponse({ description: 'Invalid or expired OTP.' })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Throttle({ short: { limit: 3, ttl: 1_000 }, medium: { limit: 5, ttl: 60_000 } })
  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend account verification OTP' })
  @ApiBody({ type: ResendOtpDto })
  @ApiOkResponse({ description: 'OTP resent successfully.' })
  @ApiBadRequestResponse({ description: 'Unable to resend OTP for the supplied email.' })
  async resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  // Credential endpoint: a much tighter burst clamp than the app-wide one.
  // 5 attempts per minute, and 3 per second, per IP. The `short` and `medium`
  // names must match SecurityModule's throttlers — an override naming a
  // throttler that does not exist is silently ignored, which is what the
  // previous `{ short: ... }` was doing against a config that defined none.
  @Throttle({ short: { limit: 3, ttl: 1_000 }, medium: { limit: 5, ttl: 60_000 } })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Throttle({ short: { limit: 3, ttl: 1_000 }, medium: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset OTP' })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiOkResponse({ description: 'Password reset OTP sent.' })
  @ApiBadRequestResponse({ description: 'Invalid email address.' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Throttle({ short: { limit: 3, ttl: 1_000 }, medium: { limit: 5, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using OTP' })
  @ApiBody({ type: ResetPasswordDto })
  @ApiOkResponse({ description: 'Password reset successful.' })
  @ApiBadRequestResponse({ description: 'Invalid reset payload or OTP.' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Throttle({ short: { limit: 3, ttl: 1_000 }, medium: { limit: 5, ttl: 60_000 } })
  @Post('decane')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with Decane Access Token' })
  @ApiBody({ type: DecaneAuthDto })
  @ApiOkResponse({ description: 'Decane authentication successful. Returns app JWT session and wallet info.' })
  @ApiBadRequestResponse({ description: 'Invalid Decane token or verification failed.' })
  async decaneAuth(@Body() dto: DecaneAuthDto) {
    return this.authService.authenticateWithDecane(dto);
  }

  //   @Post('google')
  //   @HttpCode(HttpStatus.OK)
  //   async googleAuth(@Body() dto: GoogleAuthDto) {
  //     return this.authService.googleAuth(dto);
  //   }

}
