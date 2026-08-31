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
    const token = this.generateToken(driver);

    return {
      driver: this.sanitizeDriver(driver),
      token,
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

    const token = this.generateToken(driver);

    return {
      message: 'Login successful',
      driver: this.sanitizeDriver(driver),
      token,
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

    // Check if email is being updated and if it's already taken by another driver
    if (updateDriverDto.email && updateDriverDto.email !== driver.email) {
      const existingDriver = await this.driversRepository.findOne({
        where: { email: updateDriverDto.email },
      });

      if (existingDriver) {
        throw new ConflictException('Email already in use');
      }
    }

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

    // If password is being updated, hash it
    if (updateDriverDto.password) {
      updateDriverDto.password = await bcrypt.hash(updateDriverDto.password, 10);
    }

    // Update the driver
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

    // Only approved drivers can go online
    // if (isOnline && driver.verificationStatus !== VerificationStatus.APPROVED) {
    //   throw new BadRequestException(
    //     'Only approved drivers can go online. Please wait for admin approval.',
    //   );
    // }

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

    // If rejected, set driver offline
    if (status === VerificationStatus.REJECTED) {
      driver.isOnline = false;
    }

    const updatedDriver = await this.driversRepository.save(driver);

    return this.sanitizeDriver(updatedDriver);
  }

  async remove(id: string) {
    const driver = await this.driversRepository.findOne({ where: { id } });

    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

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

    if (!driver.otpCode || driver.otpCode !== dto.otp) {
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

  private generateToken(driver: Driver): string {
    const payload = {
      sub: driver.id,
      email: driver.email,
      role: driver.role || Role.DRIVER,
      type: 'driver'
    };
    console.log('Signing driver JWT payload:', payload);

    return this.jwtService.sign(payload);
  }

  private sanitizeDriver(driver: Driver) {
    const { password, ...sanitized } = driver;
    return sanitized;
  }
}
