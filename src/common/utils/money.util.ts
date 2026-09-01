/**
 * Money Utilities
 *
 * Purpose: The ONE place fare-splitting arithmetic is allowed to live.
 *
 * Why this exists:
 * Postgres `decimal` columns come back from `pg` as strings, and repeated
 * floating point arithmetic on Naira values accumulates drift (0.1 + 0.2 !== 0.3).
 * Every calculation here is done in integer kobo (1 Naira = 100 kobo) and only
 * converted back to Naira at the moment of persistence.
 *
 * Rule: never re-derive the revenue split anywhere else. Call splitFareKobo().
 */

/**
 * Revenue split percentages defined by the Ark Rides commercial model.
 *
 * Driver:   95%
 * Platform:  4%
 * Rider:     1% (cashback)
 */
export const DRIVER_SHARE = 0.95;
export const PLATFORM_SHARE = 0.04;
export const RIDER_CASHBACK_SHARE = 0.01;

/**
 * Convert Naira to kobo (integer minor units)
 *
 * Accepts a string as well, because TypeORM hands back `decimal` columns
 * as strings and forgetting to coerce is the single easiest bug to write here.
 */
export function toKobo(naira: number | string): number {
  return Math.round(Number(naira) * 100);
}

/**
 * Convert kobo back to Naira for persistence into a decimal(x,2) column
 */
export function toNaira(kobo: number): number {
  return kobo / 100;
}

/**
 * The result of splitting a completed ride's fare between stakeholders.
 * All values are in integer kobo.
 */
export interface FareSplitKobo {
  totalKobo: number;
  driverKobo: number;
  platformKobo: number;
  riderKobo: number;
}

/**
 * Split a final fare into the 95 / 4 / 1 stakeholder shares.
 *
 * Rounding rule: the driver and rider shares are floored, and the platform
 * absorbs whatever remainder is left over. This guarantees, by construction,
 * that driverKobo + platformKobo + riderKobo === totalKobo for EVERY input.
 * There is no drift to reconcile later.
 *
 * Example (₦5,000 fare):
 *   total    = 500000 kobo
 *   driver   = 475000 kobo (₦4,750)
 *   rider    =   5000 kobo (₦50)
 *   platform =  20000 kobo (₦200)
 */
export function splitFareKobo(finalFareNaira: number | string): FareSplitKobo {
  const totalKobo = toKobo(finalFareNaira);

  const driverKobo = Math.floor(totalKobo * DRIVER_SHARE);
  const riderKobo = Math.floor(totalKobo * RIDER_CASHBACK_SHARE);

  // The platform takes the rounding remainder so the parts always sum to the whole
  const platformKobo = totalKobo - driverKobo - riderKobo;

  return { totalKobo, driverKobo, platformKobo, riderKobo };
}

/**
 * Human-readable split, in Naira, for API responses and websocket payloads.
 */
export function splitFareNaira(finalFareNaira: number | string) {
  const split = splitFareKobo(finalFareNaira);

  return {
    totalFare: toNaira(split.totalKobo),
    driverEarning: toNaira(split.driverKobo),
    platformCommission: toNaira(split.platformKobo),
    riderCashback: toNaira(split.riderKobo),
  };
}
