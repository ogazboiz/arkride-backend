import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import type { Response } from 'express';
import { ApiSuccess, Enveloped } from '../dto/api-response';

/**
 * Wraps every successful response in the single `ApiSuccess` envelope.
 *
 * Handlers stay ignorant of it: they return their data (or `enveloped(data,
 * message, meta)` when they want to say more) and this puts the uniform skin
 * on the outside. That is deliberately the opposite of the previous approach,
 * where each handler hand-built its own wrapper object and no two agreed.
 *
 * Two things are passed through untouched:
 *  - 204 No Content, which must not carry a body at all. Two handlers used to
 *    return a JSON body under `@HttpCode(204)`; Express discarded it and the
 *    client got nothing, silently.
 *  - anything already shaped like an ApiSuccess, so double-wrapping is
 *    impossible if a handler is ever migrated to build one itself.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Websocket and microservice contexts have no HTTP response to shape.
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((payload: unknown): unknown => {
        const statusCode = response.statusCode;

        if (statusCode === 204 || payload === undefined) {
          return payload;
        }

        if (isAlreadyEnvelope(payload)) {
          return payload;
        }

        if (payload instanceof Enveloped) {
          const envelope: ApiSuccess = {
            success: true,
            statusCode,
            message: payload.message ?? defaultMessage(statusCode),
            data: payload.data,
            timestamp: new Date().toISOString(),
          };
          if (payload.meta) envelope.meta = payload.meta;
          return envelope;
        }

        return {
          success: true,
          statusCode,
          message: defaultMessage(statusCode),
          data: payload,
          timestamp: new Date().toISOString(),
        } satisfies ApiSuccess;
      }),
    );
  }
}

/**
 * Exported for the unit test. A payload counts as an envelope only when it
 * carries `success: true` AND the other required keys — a domain object with a
 * boolean `success` field of its own must not be mistaken for one.
 */
export function isAlreadyEnvelope(payload: unknown): boolean {
  if (payload === null || typeof payload !== 'object') return false;
  const candidate = payload as Record<string, unknown>;
  return (
    candidate.success === true &&
    typeof candidate.statusCode === 'number' &&
    typeof candidate.message === 'string' &&
    'data' in candidate
  );
}

function defaultMessage(statusCode: number): string {
  return statusCode === 201 ? 'Created successfully' : 'Request successful';
}
