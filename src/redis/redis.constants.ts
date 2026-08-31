export const REDIS_CLIENT = 'REDIS_CLIENT';

// Prefixes for Redis keys to keep them organized
export const RIDE_LOCK_PREFIX = 'lock:ride:';
export const USER_RIDE_IDEMPOTENCY_PREFIX = 'idempotency:ride:';
export const DRIVER_LOCATION_PREFIX = 'driver:location:';
export const DRIVER_LOCATION_GEO_KEY = 'driver:locations:geo';
export const DRIVER_ACTIVE_PREFIX = 'driver:active:';
