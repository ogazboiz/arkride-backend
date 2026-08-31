import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
    constructor (
        @InjectRepository(User) 
        private readonly usersRepository: Repository<User>,
    ) {}

    async findByEmail(email: string): Promise<User | null> {
        return this.usersRepository.findOne({ where: {email}})
    } 

    async findByPhone(phone: string): Promise<User | null> {
        return this.usersRepository.findOne({ where: { phone }})
    }

    async findById(id: string): Promise<User | null> {
        return this.usersRepository.findOne({ where: { id }})
    }

    async createUser ( userData: Partial<User>): Promise<User> {
        const newUser = this.usersRepository.create(userData);
        return this.usersRepository.save(newUser);
    }

    async checkIfEmailExists(email: string): Promise<void> {
        const emailExist = await this.findByEmail(email);
        if (emailExist) {
            throw new ConflictException('Email already is use')
        }
    }

    async checkIfPhoneExists(phone: string): Promise<void> {
    const existing = await this.findByPhone(phone);
    if (existing) {
      throw new ConflictException('Phone number already in use');
    }
  }

async verifyUser(userId: string): Promise<void> {
    await this.usersRepository.update(userId, {
      isVerified: true,
      otpCode: null,
      otpExpiry: null,
    });
  }

  async updateOtp(userId: string, otpCode: string, otpExpiry: Date): Promise<void> {
    await this.usersRepository.update(userId, {
      otpCode,
      otpExpiry,
    });
  }

  async updatePassword(userId: string, hashedPassword: string): Promise<void> {
    await this.usersRepository.update(userId, {
      password: hashedPassword,
      otpCode: null,
      otpExpiry: null,
    });
  }

  // 🔥 I'll confim later if these are still needed 
  // async saveOtp(userId: string, otpCode: string, expiryMinutes: number) {
  //   const expiry = new Date(Date.now() + expiryMinutes * 60000);
  //   await this.usersRepository.update(userId, {
  //     otpCode,
  //     otpExpiry: expiry,
  //   });
  // }

  // async verifyOtp(userId: string, otpCode: string): Promise<boolean> {
  //   const user = await this.findById(userId);
  //   if (!user || user.otpCode !== otpCode || user.otpExpiry < new Date()) {
  //     return false;
  //   }
  //   await this.usersRepository.update(userId, {
  //     isVerified: true,
  //     otpCode: null,
  //     otpExpiry: null,
  //   });
  //   return true;
  // }

}
