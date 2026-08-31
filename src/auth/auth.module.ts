import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { DriversModule } from '../drivers/drivers.module';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CommonModule } from '../common/common.module';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [ 
    UsersModule, 
    DriversModule,
    PassportModule, 
    CommonModule, // Use global CommonModule for EmailService
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') || 'your-secret-key',
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy], // EmailService is now in CommonModule
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
