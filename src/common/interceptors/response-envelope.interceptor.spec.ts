import { of, firstValueFrom } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import {
  ResponseEnvelopeInterceptor,
  isAlreadyEnvelope,
} from './response-envelope.interceptor';
import { enveloped } from '../dto/api-response';

function httpContext(statusCode: number): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => ({ statusCode }) }),
  } as unknown as ExecutionContext;
}

function handlerReturning(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

async function run(
  statusCode: number,
  value: unknown,
  context = httpContext(statusCode),
): Promise<any> {
  const interceptor = new ResponseEnvelopeInterceptor();
  return firstValueFrom(
    interceptor.intercept(context, handlerReturning(value)) as any,
  );
}

describe('ResponseEnvelopeInterceptor — the single success contract', () => {
  it('wraps a bare entity, which several controllers used to return naked', () => {
    return run(200, { id: 'ride-1', fare: 1500 }).then((result) => {
      expect(result).toEqual({
        success: true,
        statusCode: 200,
        message: 'Request successful',
        data: { id: 'ride-1', fare: 1500 },
        timestamp: expect.any(String),
      });
    });
  });

  it('wraps an array without inventing a count key', () => {
    // Controllers variously returned {count, rides}, {count, drivers} and
    // {count, total, entries} for the same kind of payload.
    return run(200, [{ id: 'a' }, { id: 'b' }]).then((result) => {
      expect(result.data).toEqual([{ id: 'a' }, { id: 'b' }]);
      expect(result).not.toHaveProperty('count');
    });
  });

  it('uses a Created message for 201', async () => {
    expect((await run(201, { id: 'x' })).message).toBe('Created successfully');
  });

  it('honours a handler-supplied message', async () => {
    const result = await run(200, enveloped({ id: 'x' }, 'Ride cancelled'));
    expect(result.message).toBe('Ride cancelled');
    expect(result.data).toEqual({ id: 'x' });
  });

  it('carries pagination meta when the handler supplies it', async () => {
    const result = await run(
      200,
      enveloped([{ id: 'x' }], 'Rides fetched', {
        page: 2,
        limit: 20,
        total: 41,
        totalPages: 3,
      }),
    );
    expect(result.meta).toEqual({
      page: 2,
      limit: 20,
      total: 41,
      totalPages: 3,
    });
  });

  it('omits meta entirely when there is none', async () => {
    expect(await run(200, enveloped({ id: 'x' }))).not.toHaveProperty('meta');
  });

  it('leaves a 204 body untouched', async () => {
    // Two handlers returned a JSON body under @HttpCode(204); Express
    // discarded it and the client silently got nothing. Wrapping it would
    // have made that worse, not better.
    expect(await run(204, { message: 'Deleted' })).toEqual({
      message: 'Deleted',
    });
  });

  it('passes undefined straight through', async () => {
    expect(await run(200, undefined)).toBeUndefined();
  });

  it('does not double-wrap something already enveloped', async () => {
    const already = {
      success: true,
      statusCode: 200,
      message: 'Already done',
      data: { id: 'x' },
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    expect(await run(200, already)).toBe(already);
  });

  it('does not touch non-http contexts', async () => {
    const wsContext = { getType: () => 'ws' } as unknown as ExecutionContext;
    expect(await run(200, { raw: true }, wsContext)).toEqual({ raw: true });
  });

  describe('isAlreadyEnvelope', () => {
    it('does not mistake a domain object that happens to have success:true', () => {
      // A payout result legitimately carries { success: true, reference }.
      // Treating that as an envelope would drop it from `data`.
      expect(isAlreadyEnvelope({ success: true, reference: 'ref-1' })).toBe(
        false,
      );
    });

    it.each([null, undefined, 'string', 42, []])('rejects %p', (value) => {
      expect(isAlreadyEnvelope(value)).toBe(false);
    });

    it('accepts a complete envelope', () => {
      expect(
        isAlreadyEnvelope({
          success: true,
          statusCode: 200,
          message: 'ok',
          data: null,
        }),
      ).toBe(true);
    });
  });
});
