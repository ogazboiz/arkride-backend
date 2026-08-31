import {
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers?.authorization;

    this.logger.log({
      message: 'JWT auth request received',
      method: request.method,
      path: request.originalUrl || request.url,
      hasAuthorizationHeader: Boolean(authHeader),
      authorizationScheme: authHeader?.split(' ')[0],
    });

    return super.canActivate(context);
  }

  handleRequest(err, user, info) {
    if (err || !user) {
      this.logger.warn({
        message: 'JWT auth failed',
        error: err?.message,
        info: info?.message || info,
      });

      throw err || new UnauthorizedException(info?.message || 'Unauthorized');
    }

    this.logger.log({
      message: 'JWT auth succeeded',
      id: user.id,
      role: user.role,
    });

    return user;
  }
}
