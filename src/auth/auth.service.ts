import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { EmailService } from '../common/services/email.service';
import { OtpUtil } from '../common/utils/otp.util';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { TokenService } from './services/token.service';
import { DriversService } from '../drivers/drivers.service';
import { Role } from '../common/enums/role.enum';
import { User } from '../users/entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
    private readonly tokenService: TokenService,
    private readonly driversService: DriversService,
  ) {}

  /**
   * Exchange a refresh token for a new session.
   *
   * The subject is re-read from the database on every refresh rather than
   * trusted from the token. That is what makes a block or a suspension take
   * effect within the access-token lifetime instead of at the end of the
   * 30-day refresh window.
   */
  async refreshSession(
    refreshToken: string,
    context: { userAgent?: string | null; ipAddress?: string | null } = {},
  ) {
    const session = await this.tokenService.rotate(
      refreshToken,
      async (subjectId, subjectType) => {
        if (subjectType === Role.DRIVER) {
          const driver = await this.driversService.findForAuth(subjectId);
          if (!driver || !driver.isActive) return null;
          return { id: driver.id, role: Role.DRIVER, isDriver: true };
        }

        const user = await this.usersService.findById(subjectId);
        if (!user || user.isBlocked) return null;
        return { id: user.id, role: user.role, isDriver: false };
      },
      context,
    );

    // The same `token` alias login and register return. Without it a client
    // that reads `data.token` works at sign-in and breaks at its first
    // refresh — which is a worse failure than not having the alias at all,
    // because it appears an hour later and only for long-lived sessions.
    return { ...session, token: session.accessToken };
  }

  /** End a session. Idempotent — see AuthController.logout for why. */
  async logout(refreshToken: string): Promise<void> {
    await this.tokenService.revokeByToken(refreshToken);
  }

  async register(dto: RegisterDto) {
    // Validate terms acceptance
    if (!dto.acceptTerms) {
      throw new BadRequestException('You must accept the terms and conditions');
    }

    // Validate password match
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    // Check for existing email and phone
    await this.usersService.checkIfEmailExists(dto.email);
    await this.usersService.checkIfPhoneExists(dto.phone);

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    // Generate OTP
    const otp = OtpUtil.generate();
    const otpExpiry = OtpUtil.getExpiryTime(10); // 10 minutes

    const user = await this.usersService.createUser({
      name: dto.name,
      email: dto.email,
      phone: dto.phone,
      password: hashedPassword,
      provider: 'local',
      providerId: null,
      isVerified: true, // Auto-verify for now
      otpCode: null,
      otpExpiry: null,
    });

    // Send OTP email
    try {
      await this.emailService.sendOtpEmail(user.email, otp, user.name);
    } catch (error) {
      console.error('Failed to send OTP email:', error);
      // Don't throw error - user is created, just log the issue
    }

    const session = await this.issueSession(user);

    return {
      message: 'Registration successful. You can now login.',
      user: this.sanitizeUser(user),
      ...session,
    };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.isVerified) {
      throw new BadRequestException('Account is already verified');
    }

    if (!user.otpCode) {
      throw new BadRequestException('No OTP found. Please request a new one.');
    }

    // Constant-time. A short-circuiting `!==` leaks the code digit by
    // digit over enough requests; OtpUtil.matches was written for this and
    // was not actually being used anywhere.
    if (!OtpUtil.matches(dto.otp, user.otpCode)) {
      throw new BadRequestException('Invalid OTP');
    }

    if (!user.otpExpiry || OtpUtil.isExpired(user.otpExpiry)) {
      throw new BadRequestException('OTP has expired. Please request a new one.');
    }

    // Mark user as verified and clear OTP
    await this.usersService.verifyUser(user.id);

    // Send welcome email
    try {
      await this.emailService.sendWelcomeEmail(user.email, user.name);
    } catch (error) {
      console.error('Failed to send welcome email:', error);
    }

    const session = await this.issueSession(user);

    return {
      message: 'Account verified successfully',
      user: this.sanitizeUser({ ...user, isVerified: true }),
      ...session,
    };
  }

  async resendOtp(dto: ResendOtpDto) {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.isVerified) {
      throw new BadRequestException('Account is already verified');
    }

    // Generate new OTP
    const otp = OtpUtil.generate();
    const otpExpiry = OtpUtil.getExpiryTime(10);

    await this.usersService.updateOtp(user.id, otp, otpExpiry);

    // Send new OTP email
    try {
      await this.emailService.sendOtpEmail(user.email, otp, user.name);
    } catch (error) {
      console.error('Failed to resend OTP email:', error);
      throw new BadRequestException('Failed to send OTP. Please try again later.');
    }

    return {
      message: 'OTP has been resent to your email',
      email: user.email,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if user registered via Google
    if (!user.password) {
      throw new BadRequestException(
        'This account uses Google Sign-In. Please log in with Google.',
      );
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if user is verified
    if (!user.isVerified) {
      throw new UnauthorizedException(
        'Please verify your account first. Check your email for OTP.',
      );
    }

    const session = await this.issueSession(user);

    return {
      message: 'Login successful',
      user: this.sanitizeUser(user),
      ...session,
    };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Generate OTP
    const otp = OtpUtil.generate();
    const otpExpiry = OtpUtil.getExpiryTime(10);

    await this.usersService.updateOtp(user.id, otp, otpExpiry);

    // Send email
    try {
      await this.emailService.sendForgotPasswordEmail(user.email, otp, user.name);
    } catch (error) {
      console.error('Failed to send forgot password email:', error);
      throw new BadRequestException('Failed to send OTP. Please try again later.');
    }

    return {
      message: 'You can now reset your password',
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (!OtpUtil.matches(dto.otp, user.otpCode)) {
      throw new BadRequestException('Invalid OTP');
    }

    if (!user.otpExpiry || OtpUtil.isExpired(user.otpExpiry)) {
      throw new BadRequestException('OTP has expired');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

    await this.usersService.updatePassword(user.id, hashedPassword);

    return {
      message: 'Password has been reset successfully. You can now login with your new password.',
    };
  }


  /**
   * Issue a full session for a rider: short access token PLUS a refresh token.
   *
   * This replaces a bare `jwtService.sign()`. Access tokens are now one hour
   * rather than seven days, which is only an improvement if there is something
   * to renew them with — without this, every email/password user would be
   * signed out after an hour with no way back except re-entering their
   * password. Privy sign-in and password sign-in must hand back the same kind
   * of session, or clients need two refresh strategies.
   *
   * `token` is kept alongside `accessToken` so existing clients reading
   * `data.token` keep working through the rollout.
   */
  private async issueSession(
    user: User,
    context: { userAgent?: string | null; ipAddress?: string | null } = {},
  ) {
    const session = await this.tokenService.issueSession(
      { id: user.id, role: user.role || Role.USER, isDriver: false },
      context,
    );
    return { ...session, token: session.accessToken };
  }

  private sanitizeUser(user: User) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, otpCode, otpExpiry, ...sanitized } = user;
    return sanitized;
  }
}
