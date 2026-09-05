import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { describe as describeException } from './all-exceptions.filter';

/** Build a QueryFailedError carrying a Postgres SQLSTATE, as the driver does. */
function pgError(code: string, message = 'driver message'): QueryFailedError {
  const error = new QueryFailedError('SELECT 1', [], new Error(message));
  (error as unknown as { code: string }).code = code;
  return error;
}

describe('AllExceptionsFilter — the single error contract', () => {
  describe('message is always one string', () => {
    it('collapses the validation factory array into a summary plus field detail', () => {
      // This is the shape createValidationExceptionFactory throws. It used to
      // reach the client verbatim as a top-level ARRAY, which no other
      // endpoint in the API produced.
      const result = describeException(
        new BadRequestException([
          {
            property: 'email',
            value: 'nope',
            constraints: { isEmail: 'email must be an email' },
          },
        ]),
      );

      expect(typeof result.message).toBe('string');
      expect(result.code).toBe('VALIDATION_FAILED');
      expect(result.errors).toEqual([
        { field: 'email', messages: ['email must be an email'] },
      ]);
    });

    it('summarises rather than concatenating when several fields fail', () => {
      const result = describeException(
        new BadRequestException([
          { property: 'email', constraints: { isEmail: 'bad email' } },
          { property: 'phone', constraints: { matches: 'bad phone' } },
        ]),
      );
      expect(result.message).toBe('2 fields failed validation.');
      expect(result.errors).toHaveLength(2);
    });

    it('flattens nested children into dotted field paths', () => {
      const result = describeException(
        new BadRequestException([
          {
            property: 'pickupLocation',
            children: [
              {
                property: 'latitude',
                constraints: { isLatitude: 'latitude must be a number' },
              },
            ],
          },
        ]),
      );
      expect(result.errors).toEqual([
        {
          field: 'pickupLocation.latitude',
          messages: ['latitude must be a number'],
        },
      ]);
    });

    it("normalises Nest's own string[] message form", () => {
      const result = describeException(
        new BadRequestException({
          message: ['name should not be empty'],
          error: 'Bad Request',
          statusCode: 400,
        }),
      );
      expect(result.message).toBe('name should not be empty');
      expect(result.code).toBe('VALIDATION_FAILED');
      expect(result.errors).toHaveLength(1);
    });

    it('handles an exception thrown with an array message directly', () => {
      // driver-locations.controller.ts:131 did exactly this.
      const result = describeException(
        new NotFoundException(['no driver', 'no location']),
      );
      expect(typeof result.message).toBe('string');
      expect(result.errors).toHaveLength(2);
    });
  });

  describe('status and code mapping', () => {
    it.each([
      [new UnauthorizedException('nope'), 401, 'UNAUTHENTICATED'],
      [new ForbiddenException('nope'), 403, 'FORBIDDEN'],
      [new NotFoundException('nope'), 404, 'NOT_FOUND'],
      [new HttpException('teapot', 418), 418, 'HTTP_418'],
    ])('maps %#', (exception, status, code) => {
      const result = describeException(exception);
      expect(result.statusCode).toBe(status);
      expect(result.code).toBe(code);
      expect(result.message).toBeTruthy();
    });

    it('preserves a string payload as the message', () => {
      expect(
        describeException(new NotFoundException('Ride not found')).message,
      ).toBe('Ride not found');
    });
  });

  describe('database failures are translated, not leaked', () => {
    it('turns a unique violation into a 409 with no driver text', () => {
      const result = describeException(
        pgError(
          '23505',
          'duplicate key value violates unique constraint "users_email_key"',
        ),
      );
      expect(result.statusCode).toBe(HttpStatus.CONFLICT);
      expect(result.code).toBe('DUPLICATE_VALUE');
      expect(result.message).not.toContain('users_email_key');
    });

    it('turns a foreign key violation into a 400', () => {
      expect(describeException(pgError('23503')).statusCode).toBe(400);
    });

    it('turns a malformed UUID into a 400 rather than a 500', () => {
      // GET /rides/not-a-uuid used to produce an unhandled QueryFailedError.
      const result = describeException(pgError('22P02'));
      expect(result.statusCode).toBe(400);
      expect(result.code).toBe('MALFORMED_IDENTIFIER');
    });

    it('leaves an unrecognised SQLSTATE as a 500', () => {
      const result = describeException(pgError('XX000'));
      expect(result.statusCode).toBe(500);
      expect(result.code).toBe('DATABASE_ERROR');
    });
  });

  describe('unknown throwables', () => {
    it('classifies a bare Error as a 500', () => {
      const result = describeException(new Error('connection reset by peer'));
      expect(result.statusCode).toBe(500);
      expect(result.code).toBe('INTERNAL_ERROR');
      // describe() still carries the real message; the FILTER is what replaces
      // it before the body is written. Keeping it here is what lets the log
      // line be useful.
      expect(result.message).toBe('connection reset by peer');
    });

    it('does not crash on a thrown non-Error', () => {
      expect(describeException('a string was thrown')).toEqual({
        statusCode: 500,
        message: 'Unknown error',
        code: 'INTERNAL_ERROR',
      });
    });

    it('does not crash on a thrown null', () => {
      expect(describeException(null).statusCode).toBe(500);
    });
  });
});
