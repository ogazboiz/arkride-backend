import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

/**
 * InternalApiKeyGuard
 *
 * Purpose: Authenticate machine callers — the WhatsApp Business webhook, the
 * telephony provider's voice hook — which have no user JWT to present.
 *
 * This endpoint is service-to-service. End users never call it directly; they
 * talk to a chat agent, and the agent's backend calls us with this key. The
 * rider's own identity comes from the caller's phone number in the payload.
 *
 * Refuses to run at all if INTERNAL_API_KEY is unset, rather than defaulting
 * open — an unauthenticated ride-booking endpoint would be a free ride machine.
 */
@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(InternalApiKeyGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const configured = this.configService.get<string>('INTERNAL_API_KEY');

    if (!configured) {
      this.logger.error(
        'INTERNAL_API_KEY is not configured — refusing all omnichannel booking requests.',
      );
      throw new UnauthorizedException('Channel integration is not configured');
    }

    const request = context.switchToHttp().getRequest();
    const provided = request.headers?.['x-internal-api-key'];

    if (!provided || !this.matches(String(provided), configured)) {
      this.logger.warn({
        message: 'Rejected omnichannel request with bad or missing API key',
        path: request.originalUrl || request.url,
      });
      throw new UnauthorizedException('Invalid internal API key');
    }

    return true;
  }

  /**
   * Constant-time compare so a wrong key cannot be discovered one byte at a
   * time by measuring how long the rejection takes.
   */
  private matches(provided: string, expected: string): boolean {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);

    if (a.length !== b.length) return false;

    return timingSafeEqual(a, b);
  }
}
