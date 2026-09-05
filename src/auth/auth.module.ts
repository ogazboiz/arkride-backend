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
import { DecaneService } from './decane.service';
import { AuthResolverService } from './services/auth-resolver.service';
import { jwtModuleOptions } from '../config/jwt.config';

@Module({
  imports: [ 
    UsersModule, 
    DriversModule,
    PassportModule, 
    CommonModule, // Use global CommonModule for EmailService
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: jwtModuleOptions,
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, DecaneService, AuthResolverService],
  // AuthResolverService is exported for the websocket gateway, which must
  // resolve socket handshake tokens exactly the way HTTP requests do.
  exports: [AuthService, JwtModule, DecaneService, AuthResolverService],
})
export class AuthModule {}
