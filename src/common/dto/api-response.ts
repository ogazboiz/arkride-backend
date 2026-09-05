/**
 * The two shapes every endpoint in this API returns. Nothing else.
 *
 * Before this file there were eleven success shapes across eleven controllers
 * — `{message, driver, token}`, `{count, drivers}`, `{count, total, entries}`,
 * `{count, total, transactions}` for the same LedgerEntry list, and several
 * bare entities with no wrapper at all — and four incompatible error shapes.
 * Every client had to special-case every endpoint. That is the "inconsistency"
 * this codebase was described by, and it is fixed structurally rather than by
 * editing forty handlers to agree with each other by hand.
 */

/** Returned for any 2xx. `data` is whatever the handler returned. */
export interface ApiSuccess<T = unknown> {
  success: true;
  statusCode: number;
  message: string;
  data: T;
  /** Present only on list endpoints that paginate. */
  meta?: PaginationMeta;
  /** ISO-8601. Useful when correlating a client report with server logs. */
  timestamp: string;
}

/** Returned for any 4xx/5xx. */
export interface ApiFailure {
  success: false;
  statusCode: number;
  /** A single human sentence, always. Never an array, never an object. */
  message: string;
  /** Machine-readable discriminator, e.g. `VALIDATION_FAILED`, `NOT_FOUND`. */
  code: string;
  /**
   * Field-level detail for validation failures. Absent for everything else,
   * so a client can branch on presence rather than on status code.
   */
  errors?: FieldError[];
  path: string;
  timestamp: string;
  /** Correlates the client's report with the server log line. */
  requestId?: string;
}

export interface FieldError {
  /** Dotted path, e.g. `pickupLocation.latitude`. */
  field: string;
  /** Every failed constraint on that field. */
  messages: string[];
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Marker a handler returns to supply a message and/or pagination alongside its
 * data. The interceptor unwraps it. Handlers that don't care return their data
 * directly and get a default message.
 */
export class Enveloped<T> {
  constructor(
    readonly data: T,
    readonly message?: string,
    readonly meta?: PaginationMeta,
  ) {}
}

/** Convenience so handlers read `return enveloped(rides, 'Rides fetched', meta)`. */
export function enveloped<T>(
  data: T,
  message?: string,
  meta?: PaginationMeta,
): Enveloped<T> {
  return new Enveloped(data, message, meta);
}
