import type { OpenAPIObject } from '@nestjs/swagger';

/**
 * Make the OpenAPI document describe what the API actually returns.
 *
 * THE PROBLEM
 *
 * Every handler is decorated with `@ApiOkResponse({ type: SomeDto })`, so
 * Swagger claimed a 200 was `SomeDto` — but a global interceptor wraps every
 * response in `{ success, statusCode, message, data, timestamp }`. The
 * documented shape of all 67 operations was therefore wrong, in the same way,
 * and anyone generating a client from this spec got code that could not parse a
 * single response.
 *
 * Fixing that by hand would mean a wrapper decorator on 67 handlers, and one
 * forgotten decorator puts a lie straight back into the spec. This instead runs
 * once over the finished document: whatever schema a handler declared becomes
 * the `data` member of the envelope, and the failure shapes are attached to
 * every operation. Handlers stay ignorant of the envelope, exactly as they are
 * at runtime.
 *
 * Deliberately a post-processing pass rather than a decorator, because the
 * property that matters is that NO operation can be missed — and only walking
 * the finished document gives you that.
 */

/** Reusable schema names added to `components.schemas`. */
const SUCCESS_ENVELOPE = 'ApiSuccessEnvelope';
const FAILURE_ENVELOPE = 'ApiFailureEnvelope';
const FIELD_ERROR = 'ApiFieldError';

/** Failures an authenticated operation can produce. */
const AUTH_ERRORS: Record<string, string> = {
  '401': 'No access token, or the token is invalid or expired.',
  '403': 'Authenticated, but not allowed to act on this resource.',
};

/** Failures any operation can produce. */
const UNIVERSAL_ERRORS: Record<string, string> = {
  '429': 'Rate limit exceeded.',
  '500':
    'Unexpected server error. The body carries a `requestId` to quote when reporting it; no internal detail is exposed.',
};

/** Added where the operation accepts a body or parameters. */
const VALIDATION_ERROR: Record<string, string> = {
  '400': 'The request failed validation. `errors` lists the offending fields.',
};

/** Added where the operation addresses a specific resource. */
const NOT_FOUND_ERROR: Record<string, string> = {
  '404': 'No such resource.',
};

const HTTP_METHODS = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
]);

interface ResponseLike {
  description?: string;
  content?: Record<string, { schema?: Record<string, unknown> }>;
}

interface OperationLike {
  summary?: string;
  security?: unknown[];
  requestBody?: unknown;
  parameters?: unknown[];
  responses?: Record<string, ResponseLike>;
}

export function applyEnvelopeToDocument(document: OpenAPIObject): OpenAPIObject {
  document.components ??= {};
  document.components.schemas ??= {};
  const schemas = document.components.schemas as Record<string, unknown>;

  schemas[FIELD_ERROR] = {
    type: 'object',
    properties: {
      field: {
        type: 'string',
        example: 'pickup.lat',
        description: 'Dotted path to the offending property.',
      },
      messages: {
        type: 'array',
        items: { type: 'string' },
        example: ['lat must be between -90 and 90'],
      },
    },
    required: ['field', 'messages'],
  };

  schemas[FAILURE_ENVELOPE] = {
    type: 'object',
    description:
      'Returned for every 4xx and 5xx. `message` is ALWAYS a single string; field-level detail goes in `errors`.',
    properties: {
      success: { type: 'boolean', example: false },
      statusCode: { type: 'integer', example: 403 },
      message: {
        type: 'string',
        example: 'You can only view your own ride history.',
      },
      code: {
        type: 'string',
        description: 'Machine-readable discriminator; branch on this, not on the message.',
        example: 'FORBIDDEN',
        enum: [
          'VALIDATION_FAILED',
          'UNAUTHENTICATED',
          'FORBIDDEN',
          'NOT_FOUND',
          'CONFLICT',
          'DUPLICATE_VALUE',
          'INVALID_REFERENCE',
          'MALFORMED_IDENTIFIER',
          'RATE_LIMITED',
          'DATABASE_ERROR',
          'INTERNAL_ERROR',
        ],
      },
      errors: {
        type: 'array',
        items: { $ref: `#/components/schemas/${FIELD_ERROR}` },
        description: 'Present only for validation failures.',
      },
      path: { type: 'string', example: '/api/v1/rides/abc' },
      timestamp: { type: 'string', format: 'date-time' },
      requestId: {
        type: 'string',
        description: 'Present only on 5xx. Quote it when reporting a fault.',
      },
    },
    required: ['success', 'statusCode', 'message', 'code', 'path', 'timestamp'],
  };

  schemas[SUCCESS_ENVELOPE] = {
    type: 'object',
    description: 'Returned for every 2xx that carries a body.',
    properties: {
      success: { type: 'boolean', example: true },
      statusCode: { type: 'integer', example: 200 },
      message: { type: 'string', example: 'Request successful' },
      data: {
        description: 'The payload. Its shape is per-endpoint.',
        nullable: true,
      },
      meta: {
        type: 'object',
        description: 'Present on list endpoints.',
        properties: {
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 20 },
          total: { type: 'integer', example: 41 },
          totalPages: { type: 'integer', example: 3 },
        },
      },
      timestamp: { type: 'string', format: 'date-time' },
    },
    required: ['success', 'statusCode', 'message', 'data', 'timestamp'],
  };

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    const item = pathItem as Record<string, unknown> & {
      parameters?: unknown[];
    };
    for (const [method, operation] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method)) continue;
      decorateOperation(
        operation as OperationLike,
        path,
        Boolean(item.parameters?.length),
      );
    }
  }

  return document;
}

function decorateOperation(
  operation: OperationLike,
  path: string,
  pathHasParameters: boolean,
): void {
  operation.responses ??= {};

  // 1. Wrap each declared success schema as the envelope's `data`.
  for (const [status, response] of Object.entries(operation.responses)) {
    if (!/^2\d\d$/.test(status)) continue;

    // 204 carries no body at all — wrapping it would document a lie.
    if (status === '204') {
      delete response.content;
      response.description ??= 'No content.';
      continue;
    }

    const declared = response.content?.['application/json']?.schema;
    response.content = {
      'application/json': {
        schema: {
          allOf: [
            { $ref: `#/components/schemas/${SUCCESS_ENVELOPE}` },
            {
              type: 'object',
              properties: {
                // A handler that declared nothing still gets the envelope,
                // with `data` left unconstrained rather than absent.
                data: declared ?? { nullable: true },
              },
            },
          ],
        },
      },
    };
  }

  // 2. Attach the failure shapes this operation can actually produce.
  const applicable: Record<string, string> = { ...UNIVERSAL_ERRORS };

  if (operation.requestBody) Object.assign(applicable, VALIDATION_ERROR);
  if (pathHasParameters || operation.parameters?.length) {
    Object.assign(applicable, VALIDATION_ERROR, NOT_FOUND_ERROR);
  }
  if (operation.security?.length) Object.assign(applicable, AUTH_ERRORS);
  // A `{param}` in the path means the resource can be missing even when Nest
  // emitted no parameter list, which it does when the handler has no @ApiParam.
  if (/\{[^}]+\}/.test(path)) Object.assign(applicable, NOT_FOUND_ERROR);

  for (const [status, description] of Object.entries(applicable)) {
    // Never overwrite a description a handler wrote deliberately.
    if (operation.responses[status]) continue;
    operation.responses[status] = {
      description,
      content: {
        'application/json': {
          schema: { $ref: `#/components/schemas/${FAILURE_ENVELOPE}` },
        },
      },
    };
  }
}
