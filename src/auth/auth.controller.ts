import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service'
import { RegisterDto } from './dto/register.dto';
// import { GoogleAuthDto } from './dto/google-auth.dto';
import { LoginDto } from './dto/login.dto'
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Throttle } from '@nestjs/throttler';
import { ApiBadRequestResponse, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';


@ApiTags('Auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post('register')
  @ApiOperation({ summary: 'Register a new user account' })
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({ description: 'Registration successful. OTP sent for verification.' })
  @ApiBadRequestResponse({ description: 'Invalid registration payload.' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto)
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify account with OTP' })
  @ApiBody({ type: VerifyOtpDto })
  @ApiOkResponse({ description: 'OTP verified successfully.' })
  @ApiBadRequestResponse({ description: 'Invalid or expired OTP.' })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

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
  @Throttle({ short: { limit: 3, ttl: 1000 }})
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset OTP' })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiOkResponse({ description: 'Password reset OTP sent.' })
  @ApiBadRequestResponse({ description: 'Invalid email address.' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using OTP' })
  @ApiBody({ type: ResetPasswordDto })
  @ApiOkResponse({ description: 'Password reset successful.' })
  @ApiBadRequestResponse({ description: 'Invalid reset payload or OTP.' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  //   @Post('google')
  //   @HttpCode(HttpStatus.OK)
  //   async googleAuth(@Body() dto: GoogleAuthDto) {
  //     return this.authService.googleAuth(dto);
  //   }

}
