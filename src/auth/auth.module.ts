import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { DriversModule } from '../drivers/drivers.module';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { CommonModule } from '../common/common.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthResolverService } from './services/auth-resolver.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { Driver } from '../drivers/entities/driver.entity';
import { TokenModule } from './token.module';
import { PrivyService } from './privy/privy.service';
import { PrivyAuthService } from './privy/privy-auth.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Driver]),
    TokenModule,
    UsersModule, 
    DriversModule,
    PassportModule, 
    CommonModule, // Use global CommonModule for EmailService
    // JwtModule comes from TokenModule, which already registers it with the
    // same factory. Registering it a second time here re-read the secret and
    // was exactly the duplication the TokenModule extraction removed.
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    AuthResolverService,
    PrivyService,
    PrivyAuthService,
  ],
  // AuthResolverService is exported for the websocket gateway, which must
  // resolve socket handshake tokens exactly the way HTTP requests do.
  exports: [
    AuthService,
    // TokenModule rather than JwtModule directly: a module may only export
    // what it imports, and JwtModule now arrives via TokenModule. Exporting
    // TokenModule re-exports JwtModule with it, which is what the websocket
    // gateway needs for handshake verification.
    TokenModule,
    AuthResolverService,
    PrivyService,
  ],
})
export class AuthModule {}
