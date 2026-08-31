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
import { User } from '../users/entities/user.entity';
import { Role } from '../common/enums/role.enum';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
  ) {}

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

    const token = this.generateToken(user);

    return {
      message: 'Registration successful. You can now login.',
      user: this.sanitizeUser(user),
      token,
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

    if (user.otpCode !== dto.otp) {
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

    const token = this.generateToken(user);

    return {
      message: 'Account verified successfully',
      user: this.sanitizeUser({ ...user, isVerified: true }),
      token,
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

    const token = this.generateToken(user);

    return {
      message: 'Login successful',
      user: this.sanitizeUser(user),
      token,
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

    if (!user.otpCode || user.otpCode !== dto.otp) {
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

  private generateToken(user: User): string {
    const payload = { 
      sub: user.id, 
      email: user.email,
      role: user.role || Role.USER,
      type: 'user'
    };
    return this.jwtService.sign(payload);
  }

  private sanitizeUser(user: User) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, otpCode, otpExpiry, ...sanitized } = user;
    return sanitized;
  }
}
