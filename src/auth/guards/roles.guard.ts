import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../../common/enums/role.enum';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    const { user } = request;
    
    // Check if user exists and has a role that matches at least one required role
    const hasRequiredRole = Boolean(
      user && user.role && requiredRoles.some((role) => user.role === role),
    );

    if (!hasRequiredRole) {
      this.logger.warn({
        message: 'Role authorization failed',
        method: request.method,
        path: request.originalUrl || request.url,
        userId: user?.id,
        userRole: user?.role,
        requiredRoles,
      });
    }

    return hasRequiredRole;
  }
}
