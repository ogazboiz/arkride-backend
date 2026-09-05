/**
 * Turn untrusted `limit` / `offset` query values into safe numbers.
 *
 * Several list endpoints did `Number(limit)` on a raw query string with no
 * validation and no bound. `?limit=abc` produced NaN, which TypeORM passes
 * straight to `take:` and Postgres rejects with a driver error — a 500 from a
 * one-character typo. `?limit=999999999` was simply honoured, so any
 * authenticated caller could ask for the whole table.
 *
 * `clampRadiusKm` in driver-locations already did this correctly; this is the
 * same idea, in one place, for the endpoints that did not.
 */

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

/**
 * A usable page size.
 *
 * NaN, zero, negatives and absurd values each have a different right answer,
 * and none of them is "pass it to the database and find out".
 */
export function clampLimit(
  raw: string | number | undefined | null,
  fallback = DEFAULT_PAGE_LIMIT,
  max = MAX_PAGE_LIMIT,
): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const floored = Math.floor(parsed);
  if (floored < 1) return fallback;
  return Math.min(floored, max);
}

/** A non-negative offset. Anything unusable becomes 0. */
export function clampOffset(raw: string | number | undefined | null): number {
  if (raw === undefined || raw === null || raw === '') return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}
