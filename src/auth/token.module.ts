import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RefreshToken } from './entities/refresh-token.entity';
import { TokenService } from './services/token.service';
import { TokenCleanupService } from './services/token-cleanup.service';
import { jwtModuleOptions } from '../config/jwt.config';

/**
 * Session issuance, on its own.
 *
 * TokenService started life inside AuthModule, but DRIVERS need it too — a
 * driver logging in must get the same access + refresh pair a rider does, or
 * they are signed out after an hour with no way to renew. AuthModule already
 * imports DriversModule, so having DriversModule import AuthModule back would
 * be a circular dependency.
 *
 * A leaf module both can import is the way out, and it is the honest shape
 * anyway: issuing a session does not depend on how the caller proved who they
 * were, which is exactly why local login, driver login and Privy sign-in can
 * all end here.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([RefreshToken]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: jwtModuleOptions,
    }),
  ],
  providers: [TokenService, TokenCleanupService],
  exports: [TokenService, JwtModule],
})
export class TokenModule {}
