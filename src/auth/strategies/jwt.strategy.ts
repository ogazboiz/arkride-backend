import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import { DriversService } from '../../drivers/drivers.service';
import { Role } from '../../common/enums/role.enum';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly driversService: DriversService,
    private readonly configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: configService.get<string>('JWT_SECRET') || 'your-secret-key',
    });
  }

  async validate(payload: any) {
    this.logger.log({
      message: 'Decoded JWT payload',
      subject: payload?.sub,
      role: payload?.role,
      type: payload?.type,
    });

    const { sub, role } = payload;

    // Handle Driver
    if (payload.type === 'driver' && role === Role.DRIVER) {
      const driver = await this.driversService.findForAuth(sub);
      if (!driver) {
        throw new UnauthorizedException('Invalid driver token');
      }
      return { ...driver, role: Role.DRIVER };
    }

    // Handle Admin (if you have an adminsService, otherwise default to user with admin role)
    if (role === Role.ADMIN) {
      const user = await this.usersService.findById(sub);
      if (!user) {
        throw new UnauthorizedException('Admin user not found');
      }
      return { ...user, role: Role.ADMIN };
    }

    // Default to User
    const user = await this.usersService.findById(sub);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return { ...user, role: Role.USER };
  }
}
