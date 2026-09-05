import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ApiFailure, FieldError } from '../dto/api-response';

/**
 * The single error contract for the whole API.
 *
 * There were four before this:
 *   - validation failures: an ARRAY of {property, value, constraints, children}
 *   - business errors:     Nest's {statusCode, message, error}
 *   - one controller:      NotFoundException with an ARRAY message
 *   - RolesGuard:          `return false`, i.e. a bare 403 with no body
 *
 * A client could not write one error handler. Now every failure — thrown,
 * unhandled, or from the database driver — leaves as `ApiFailure`.
 *
 * Two rules it enforces that the old behaviour did not:
 *   1. `message` is ALWAYS a single string. Field detail goes in `errors`.
 *   2. A 5xx never leaks its internals. The real message and stack go to the
 *      log against a `requestId`; the client gets that id and nothing else.
 *      Previously an unhandled `Error` had `err.message` echoed to the caller.
 */
/**
 * Anything at or above this is our fault, not the caller's, and its detail must
 * not reach them. A plain number rather than `HttpStatus.INTERNAL_SERVER_ERROR`
 * because `getStatus()` returns `number`, and comparing a number against a
 * numeric enum member is the kind of cross-type comparison that reads as a type
 * error even when it works.
 */
const SERVER_ERROR_THRESHOLD = 500;

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    // A websocket exception has no HTTP response to write to.
    //
    // This used to `throw exception` — which is wrong, because this filter IS
    // the gateway's error handling and there is nothing above it to catch. The
    // rejection escaped the socket.io proxy, became an unhandled rejection,
    // and on Node >= 15 that terminates the process. At best the client's ack
    // never resolved and the socket hung with no explanation.
    //
    // Now: tell the client, log it, and let the process live.
    if (host.getType() !== 'http') {
      this.handleWsException(exception, host);
      return;
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, message, code, errors } = describe(exception);

    const body: ApiFailure = {
      success: false,
      statusCode,
      message,
      code,
      path: request.originalUrl ?? request.url,
      timestamp: new Date().toISOString(),
    };

    if (errors) body.errors = errors;

    if (statusCode >= SERVER_ERROR_THRESHOLD) {
      // The one place a request id is minted: the client needs something to
      // quote, and there is nothing to quote on a successful request.
      const requestId = randomUUID();
      body.requestId = requestId;
      body.message =
        'Something went wrong on our side. Quote the request id when reporting this.';

      this.logger.error({
        requestId,
        method: request.method,
        path: body.path,
        message: message,
        stack: exception instanceof Error ? exception.stack : undefined,
      });
    } else {
      this.logger.warn({
        method: request.method,
        path: body.path,
        statusCode,
        code,
        message,
      });
    }

    response.status(statusCode).json(body);
  }

  /**
   * Report a failure on a websocket without taking the process down with it.
   *
   * The client gets the same `code`/`message` contract HTTP callers get, minus
   * anything internal. A 5xx is logged with a request id and the client is
   * told only that id.
   */
  private handleWsException(exception: unknown, host: ArgumentsHost): void {
    const { statusCode, message, code } = describe(exception);

    const isServerFault = statusCode >= SERVER_ERROR_THRESHOLD;
    const requestId = isServerFault ? randomUUID() : undefined;

    if (isServerFault) {
      this.logger.error({
        requestId,
        transport: 'ws',
        message,
        stack: exception instanceof Error ? exception.stack : undefined,
      });
    } else {
      this.logger.warn({ transport: 'ws', statusCode, code, message });
    }

    try {
      const client = host.switchToWs().getClient<{
        emit?: (event: string, payload: unknown) => void;
      }>();
      client?.emit?.('exception', {
        success: false,
        statusCode,
        code,
        message: isServerFault
          ? 'Something went wrong on our side. Quote the request id when reporting this.'
          : message,
        ...(requestId ? { requestId } : {}),
        timestamp: new Date().toISOString(),
      });
    } catch (emitError) {
      // A socket that has already gone away cannot be told anything. That is
      // not a reason to crash either.
      this.logger.debug({
        message: 'Could not deliver a websocket error to the client',
        error:
          emitError instanceof Error ? emitError.message : String(emitError),
      });
    }
  }
}

interface Described {
  statusCode: number;
  message: string;
  code: string;
  errors?: FieldError[];
}

/**
 * Normalise anything throwable into the envelope's fields.
 *
 * Exported for the unit test — this is the whole behaviour of the filter, and
 * testing it directly avoids standing up an HTTP server to assert on shapes.
 */
export function describe(exception: unknown): Described {
  if (exception instanceof HttpException) {
    return describeHttpException(exception);
  }

  if (exception instanceof QueryFailedError) {
    return describeQueryFailure(exception);
  }

  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    message: exception instanceof Error ? exception.message : 'Unknown error',
    code: 'INTERNAL_ERROR',
  };
}

function describeHttpException(exception: HttpException): Described {
  const statusCode = exception.getStatus();
  const payload = exception.getResponse();

  // An array reaches us two ways and both must land in the same place:
  //
  //   1. `new BadRequestException([...])` — Nest's createBody wraps the array
  //      into `{ message: [...] }`, so getResponse() is an OBJECT whose
  //      `message` is the array. This is what our own
  //      createValidationExceptionFactory produces, i.e. the common case.
  //   2. A payload that is itself an array, if anything ever throws one
  //      directly.
  //
  // Getting this wrong is silent: the errors list comes back empty and the
  // client loses every field message. The unit test pins both paths.
  const arrayPayload = extractArray(payload);
  if (arrayPayload) {
    const errors = toFieldErrors(arrayPayload);
    return {
      statusCode,
      message: summarise(errors),
      code: 'VALIDATION_FAILED',
      errors,
    };
  }

  if (typeof payload === 'string') {
    return { statusCode, message: payload, code: codeFor(statusCode) };
  }

  if (payload !== null && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const raw = record.message;

    return {
      statusCode,
      message: typeof raw === 'string' ? raw : exception.message,
      code: typeof record.code === 'string' ? record.code : codeFor(statusCode),
    };
  }

  return { statusCode, message: exception.message, code: codeFor(statusCode) };
}

/**
 * Postgres error codes worth translating. Anything else stays a 500 — a driver
 * message is not something to show a user.
 */
function describeQueryFailure(exception: QueryFailedError): Described {
  const pgCode = (exception as unknown as { code?: string }).code;

  switch (pgCode) {
    case '23505': // unique_violation
      return {
        statusCode: HttpStatus.CONFLICT,
        message: 'That value is already taken.',
        code: 'DUPLICATE_VALUE',
      };
    case '23503': // foreign_key_violation
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'That reference does not exist.',
        code: 'INVALID_REFERENCE',
      };
    case '22P02': // invalid_text_representation, e.g. a malformed UUID
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'One of the supplied identifiers is malformed.',
        code: 'MALFORMED_IDENTIFIER',
      };
    default:
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: exception.message,
        code: 'DATABASE_ERROR',
      };
  }
}

/**
 * The array of validation errors, however it was wrapped, or null.
 *
 * Exported for the unit test because the wrapping is the subtle part: Nest's
 * HttpException.createBody moves an array argument under `message`, so
 * `Array.isArray(getResponse())` is false for the exact exception our own
 * validation factory throws.
 */
export function extractArray(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload as unknown[];
  if (payload !== null && typeof payload === 'object') {
    const message: unknown = (payload as Record<string, unknown>).message;
    if (Array.isArray(message)) return message as unknown[];
  }
  return null;
}

/** Flatten the validation factory's nested shape into `field` -> `messages`. */
function toFieldErrors(payload: unknown[]): FieldError[] {
  const out: FieldError[] = [];

  const walk = (entries: unknown[], prefix: string): void => {
    for (const entry of entries) {
      // Nest's DEFAULT validation factory produces plain strings
      // ("name should not be empty") rather than per-property objects. Both
      // forms are in play because not every pipe in the app is ours.
      if (typeof entry === 'string') {
        out.push({ field: prefix, messages: [entry] });
        continue;
      }
      if (entry === null || typeof entry !== 'object') continue;
      const node = entry as {
        property?: string;
        constraints?: Record<string, string>;
        children?: unknown[];
      };
      const field = prefix
        ? `${prefix}.${node.property ?? ''}`
        : (node.property ?? '');

      if (node.constraints) {
        out.push({ field, messages: Object.values(node.constraints) });
      }
      if (Array.isArray(node.children) && node.children.length > 0) {
        walk(node.children, field);
      }
    }
  };

  walk(payload, '');
  return out;
}

function summarise(errors: FieldError[]): string {
  if (errors.length === 0) return 'The request failed validation.';
  if (errors.length === 1) {
    const only = errors[0];
    return only.field ? `${only.field}: ${only.messages[0]}` : only.messages[0];
  }
  return `${errors.length} fields failed validation.`;
}

function codeFor(statusCode: number): string {
  const known: Record<number, string> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHENTICATED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    422: 'UNPROCESSABLE',
    429: 'RATE_LIMITED',
  };
  return known[statusCode] ?? `HTTP_${statusCode}`;
}
