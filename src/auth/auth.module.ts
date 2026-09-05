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
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from '../users/entities/user.entity';
import { Driver } from '../drivers/entities/driver.entity';
import { TokenService } from './services/token.service';
import { PrivyService } from './privy/privy.service';
import { PrivyAuthService } from './privy/privy-auth.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([RefreshToken, User, Driver]),
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
  providers: [
    AuthService,
    JwtStrategy,
    DecaneService,
    AuthResolverService,
    TokenService,
    PrivyService,
    PrivyAuthService,
  ],
  // AuthResolverService is exported for the websocket gateway, which must
  // resolve socket handshake tokens exactly the way HTTP requests do.
  exports: [
    AuthService,
    JwtModule,
    DecaneService,
    AuthResolverService,
    TokenService,
    PrivyService,
  ],
})
export class AuthModule {}
