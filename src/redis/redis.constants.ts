export const REDIS_CLIENT = 'REDIS_CLIENT';

// Prefixes for Redis keys to keep them organized
export const RIDE_LOCK_PREFIX = 'lock:ride:';
export const USER_RIDE_IDEMPOTENCY_PREFIX = 'idempotency:ride:';
export const DRIVER_LOCATION_PREFIX = 'driver:location:';
export const DRIVER_LOCATION_GEO_KEY = 'driver:locations:geo';
export const DRIVER_ACTIVE_PREFIX = 'driver:active:';

// Maps a driver to the ride they are currently serving.
// Lets location pings be forwarded to the right ride room in realtime
// without hitting Postgres on every GPS update.
export const DRIVER_ACTIVE_RIDE_PREFIX = 'driver:active-ride:';

// Guards driver wallet mutations (fuel support / payouts) against double submission
export const WALLET_LOCK_PREFIX = 'lock:wallet:';
