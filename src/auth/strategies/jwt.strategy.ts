import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthResolverService } from '../services/auth-resolver.service';
import { requireJwtSecret } from '../../config/jwt.config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private readonly authResolver: AuthResolverService,
    private readonly configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: requireJwtSecret(configService),
      issuer: 'arkrides',
    });
  }

  async validate(payload: any) {
    this.logger.log({
      message: 'Decoded JWT payload',
      subject: payload?.sub,
      role: payload?.role,
      type: payload?.type,
    });

    // Resolution is shared with the websocket gateway so HTTP and realtime
    // can never disagree about who a token belongs to.
    return await this.authResolver.resolvePrincipal(payload);
  }
}
