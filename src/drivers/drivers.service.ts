import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Driver, VerificationStatus } from './entities/driver.entity';
import { Vehicle, VehicleType } from '../vehicles/entities/vehicle.entity';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { EmailService } from '../common/services/email.service';
import { TokenService } from '../auth/services/token.service';
import { OtpUtil } from '../common/utils/otp.util';
import { Role } from '../common/enums/role.enum';

@Injectable()
export class DriversService {
  private readonly logger = new Logger(DriversService.name);

  constructor(
    @InjectRepository(Driver)
    private readonly driversRepository: Repository<Driver>,
    @InjectRepository(Vehicle)
    private readonly vehicleRepository: Repository<Vehicle>,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
    private readonly tokenService: TokenService,
  ) { }

  async create(createDriverDto: CreateDriverDto) {
    const { 
      vehicleType, 
      plateNumber, 
      vehicleColor, 
      vehicleModel, 
      vehicleYear, 
      ...driverData 
    } = createDriverDto;

    // Check if email already exists
    const existingEmail = await this.driversRepository.findOne({
      where: { email: driverData.email },
    });

    if (existingEmail) {
      throw new ConflictException('Email already exists');
    }

    // Check if phone already exists
    const existingPhone = await this.driversRepository.findOne({
      where: { phone: driverData.phone },
    });

    if (existingPhone) {
      throw new ConflictException('Phone number already exists');
    }

    // Check if license number already exists
    const existingLicense = await this.driversRepository.findOne({
      where: { licenseNumber: driverData.licenseNumber },
    });

    if (existingLicense) {
      throw new ConflictException('License number already exists');
    }

    // Check if plate number already exists
    const existingPlate = await this.vehicleRepository.findOne({
      where: { plateNumber },
    });

    if (existingPlate) {
      throw new ConflictException('Vehicle with this plate number already exists');
    }

    // Validate license expiry date
    const expiryDate = new Date(driverData.licenseExpiry);
    if (expiryDate <= new Date()) {
      throw new BadRequestException('License has expired or expiry date is invalid');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(driverData.password, 10);

    // Create new driver
    const newDriver = this.driversRepository.create({
      ...driverData,
      password: hashedPassword,
      verificationStatus: VerificationStatus.PENDING,
      isOnline: false,
      isActive: true,
      ratingAverage: 0,
      totalCompletedRides: 0,
      walletBalance: 0,
    });

    const driver = await this.driversRepository.save(newDriver);

    // Create vehicle record for the driver
    const vehicle = this.vehicleRepository.create({
      driverId: driver.id,
      type: vehicleType as VehicleType,
      plateNumber,
      color: vehicleColor,
      model: vehicleModel,
      year: Number(vehicleYear),
      isActive: true, // Automatically active to allow driver to see rides
    });

    await this.vehicleRepository.save(vehicle);

    // Generate token for immediate login
    const session = await this.issueSession(driver);

    return {
      driver: this.sanitizeDriver(driver),
      ...session,
    };
  }

  async login(loginDto: { email: string; password: string }) {
    const driver = await this.driversRepository.findOne({
      where: { email: loginDto.email },
      relations: ['vehicles'],
    });

    if (!driver) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // A driver who signed up through Privy has no password. Say so plainly
    // rather than returning "invalid credentials" — they would otherwise sit
    // there retrying a password that does not exist. This reveals nothing an
    // attacker can use: they already had to know a registered email, and the
    // remedy it points at (sign in with Privy) is the public sign-in method.
    if (!driver.password) {
      throw new UnauthorizedException(
        'This account signs in with Privy. Use Privy sign-in instead of a password.',
      );
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      driver.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!driver.isActive) {
      throw new UnauthorizedException('Your account has been deactivated');
    }

    const session = await this.issueSession(driver);

    return {
      message: 'Login successful',
      driver: this.sanitizeDriver(driver),
      ...session,
    };
  }

  async findAll() {
    const drivers = await this.driversRepository.find({
      relations: ['vehicles'],
      order: { createdAt: 'DESC' },
    });
    return drivers.map((driver) => this.sanitizeDriver(driver));
  }

  async findOne(id: string) {
    const driver = await this.driversRepository.findOne({
      where: { id },
      relations: ['vehicles'],
    });

    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    return this.sanitizeDriver(driver);
  }

  async findForAuth(id: string) {
    const driver = await this.driversRepository.findOne({
      where: { id, isActive: true },
    });

    if (!driver) {
      return null;
    }

    return this.sanitizeDriver(driver);
  }

  async update(id: string, updateDriverDto: UpdateDriverDto) {
    const driver = await this.driversRepository.findOne({ where: { id } });

    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    // (An email uniqueness check used to live here. `email` is no longer on
    // UpdateDriverDto — see the DTO for why — so there is nothing to check.)

    // Check if phone is being updated and if it's already taken by another driver
    if (updateDriverDto.phone && updateDriverDto.phone !== driver.phone) {
      const existingDriver = await this.driversRepository.findOne({
        where: { phone: updateDriverDto.phone },
      });

      if (existingDriver) {
        throw new ConflictException('Phone number already in use');
      }
    }

    // Check if license number is being updated and if it's already taken
    if (updateDriverDto.licenseNumber && updateDriverDto.licenseNumber !== driver.licenseNumber) {
      const existingDriver = await this.driversRepository.findOne({
        where: { licenseNumber: updateDriverDto.licenseNumber },
      });

      if (existingDriver) {
        throw new ConflictException('License number already in use');
      }
    }

    // Validate license expiry if being updated
    if (updateDriverDto.licenseExpiry) {
      const expiryDate = new Date(updateDriverDto.licenseExpiry);
      if (expiryDate <= new Date()) {
        throw new BadRequestException('License has expired or expiry date is invalid');
      }
    }

    // NOTE: `password` and `email` are deliberately not on UpdateDriverDto —
    // password changes go through forgot-password/reset-password, and an email
    // change would need re-verification. There is therefore nothing to hash
    // here, and Object.assign below cannot reach a credential column.
    //
    // Object.assign is only safe because the DTO is a written-out allowlist.
    // If anyone widens that DTO, this line widens with it.
    Object.assign(driver, updateDriverDto);
    const updatedDriver = await this.driversRepository.save(driver);

    return this.sanitizeDriver(updatedDriver);
  }

  async updateOnlineStatus(id: string, isOnline: boolean) {
    this.logger.log({
      message: 'Looking up driver for online status update',
      driverId: id,
      requestedIsOnline: isOnline,
      requestedIsOnlineType: typeof isOnline,
    });

    const driver = await this.driversRepository.findOne({ where: { id } });

    if (!driver) {
      this.logger.warn({
        message: 'Driver online status update failed: driver not found',
        driverId: id,
      });

      throw new NotFoundException('Driver not found');
    }

    // Only approved drivers may take rides.
    //
    // This check was commented out, which made `verificationStatus` decorative:
    // a driver whose licence had never been reviewed could go online, appear in
    // /drivers/available and accept passengers. Combined with the (now fixed)
    // self-approval hole on PATCH /drivers/:id, there was no point at which
    // anyone had to look at a licence.
    //
    // Going OFFLINE is always allowed regardless of status — a suspended driver
    // must still be able to remove themselves from dispatch.
    if (isOnline && driver.verificationStatus !== VerificationStatus.APPROVED) {
      throw new BadRequestException(
        'Only approved drivers can go online. Your account is currently ' +
          `${driver.verificationStatus}.`,
      );
    }

    if (isOnline && !driver.isActive) {
      throw new BadRequestException(
        'This driver account is suspended and cannot go online.',
      );
    }

    const previousIsOnline = driver.isOnline;

    driver.isOnline = isOnline;
    const updatedDriver = await this.driversRepository.save(driver);

    this.logger.log({
      message: 'Driver online status saved',
      driverId: updatedDriver.id,
      previousIsOnline,
      savedIsOnline: updatedDriver.isOnline,
    });

    return this.sanitizeDriver(updatedDriver);
  }

  async updateVerificationStatus(id: string, status: VerificationStatus) {
    const driver = await this.driversRepository.findOne({ where: { id } });

    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    driver.verificationStatus = status;

    // Anything other than approved must also take them off dispatch. Rejecting
    // a driver who was already online used to leave them online and taking
    // rides until they happened to toggle it themselves.
    if (status !== VerificationStatus.APPROVED) {
      driver.isOnline = false;
    }

    const updatedDriver = await this.driversRepository.save(driver);

    // Losing approval ends the session too — the same reasoning as suspension.
    if (status !== VerificationStatus.APPROVED) {
      await this.tokenService.revokeAllForSubject(driver.id, Role.DRIVER);
    }

    this.logger.log({
      message: 'Driver verification status changed',
      driverId: driver.id,
      status,
    });

    return this.sanitizeDriver(updatedDriver);
  }

  /**
   * Admin suspension / reinstatement.
   *
   * Suspending also forces the driver offline in the same write, so a
   * suspended driver cannot keep serving the rides they already had queued
   * up in the dispatch list.
   */
  async updateActiveStatus(id: string, isActive: boolean, reason?: string) {
    const driver = await this.driversRepository.findOne({ where: { id } });

    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    driver.isActive = isActive;
    if (!isActive) {
      driver.isOnline = false;
    }

    const updatedDriver = await this.driversRepository.save(driver);

    // Suspension has to END THE SESSION, not just set a flag. Access tokens
    // last an hour and refresh tokens thirty days, so without this a suspended
    // driver kept working for up to a month. TokenService.revokeAllForSubject
    // existed for exactly this and had no caller.
    if (!isActive) {
      await this.tokenService.revokeAllForSubject(driver.id, Role.DRIVER);
    }

    this.logger.log({
      message: isActive ? 'Driver reinstated' : 'Driver suspended',
      driverId: driver.id,
      reason: reason ?? null,
    });

    return this.sanitizeDriver(updatedDriver);
  }

  async remove(id: string) {
    const driver = await this.driversRepository.findOne({ where: { id } });

    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    // Sessions first: there is no foreign key from refresh_tokens.subjectId,
    // so deleting the driver would otherwise leave live tokens pointing at a
    // row that no longer exists.
    await this.tokenService.revokeAllForSubject(driver.id, Role.DRIVER);
    await this.driversRepository.remove(driver);
  }

  /**
   * Request password reset
   * 
   * POST /api/v1/drivers/forgot-password
   * 
   * Generates a 4-digit OTP and sends it to the driver's email
   * OTP is valid for 10 minutes
   */
  async forgotPassword(dto: { email: string }) {
    const driver = await this.driversRepository.findOne({
      where: { email: dto.email },
    });

    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    // Generate OTP
    const otp = OtpUtil.generate();
    const otpExpiry = OtpUtil.getExpiryTime(10); // 10 minutes

    await this.updateOtp(driver.id, otp, otpExpiry);

    // Send email
    try {
      await this.emailService.sendForgotPasswordEmail(driver.email, otp, driver.name);
    } catch (error) {
      console.error('Failed to send forgot password email:', error);
      throw new BadRequestException('Failed to send OTP. Please try again later.');
    }

    return {
      message: 'OTP has been sent to your email. You can now reset your password.',
    };
  }

  /**
   * Reset password with OTP
   * 
   * POST /api/v1/drivers/reset-password
   * 
   * Verifies OTP and updates password
   */
  async resetPassword(dto: { email: string; otp: string; newPassword: string }) {
    const driver = await this.driversRepository.findOne({
      where: { email: dto.email },
    });

    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    // Constant-time — see OtpUtil.matches.
    if (!OtpUtil.matches(dto.otp, driver.otpCode)) {
      throw new BadRequestException('Invalid OTP');
    }

    if (!driver.otpExpiry || OtpUtil.isExpired(driver.otpExpiry)) {
      throw new BadRequestException('OTP has expired. Please request a new one.');
    }

    // Hash and update password
    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);
    await this.updatePassword(driver.id, hashedPassword);

    return {
      message: 'Password has been reset successfully. You can now login with your new password.',
    };
  }

  /**
   * Update OTP for password reset
   * 
   * Private helper method
   */
  private async updateOtp(driverId: string, otpCode: string, otpExpiry: Date): Promise<void> {
    await this.driversRepository.update(driverId, {
      otpCode,
      otpExpiry,
    });
  }

  /**
   * Update password and clear OTP
   * 
   * Private helper method
   */
  private async updatePassword(driverId: string, hashedPassword: string): Promise<void> {
    await this.driversRepository.update(driverId, {
      password: hashedPassword,
      otpCode: null,
      otpExpiry: null,
    });
  }

  /**
   * Issue a full session for a driver. See AuthService.issueSession for why a
   * bare signed token is no longer enough.
   *
   * The `console.log('Signing driver JWT payload:', payload)` that used to sit
   * here printed the driver's id, email and role to stdout on every single
   * login. It is gone.
   */
  private async issueSession(
    driver: Driver,
    context: { userAgent?: string | null; ipAddress?: string | null } = {},
  ) {
    const session = await this.tokenService.issueSession(
      { id: driver.id, role: driver.role || Role.DRIVER, isDriver: true },
      context,
    );
    return { ...session, token: session.accessToken };
  }

  private sanitizeDriver(driver: Driver) {
    const { password, ...sanitized } = driver;
    return sanitized;
  }
}
