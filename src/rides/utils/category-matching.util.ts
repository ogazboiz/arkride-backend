import { RideCategory } from '../entities/ride.entity';
import { VehicleType } from '../../vehicles/entities/vehicle.entity';

/**
 * Fleet Matching Rules
 *
 * Purpose: One source of truth for "which vehicle can serve which ride category"
 * and "which categories block a driver from taking more work".
 *
 * Why this exists:
 * These rules used to be hardcoded if-chains inside RidesService.acceptRide()
 * and findAvailableRides(). They are now consulted by the ride service, the
 * websocket gateway (to decide which broadcast rooms a driver belongs in) and
 * the omnichannel booking parser. Adding a new fleet class should be a change
 * in this file only.
 */

/**
 * The vehicle type required to serve each ride category.
 *
 * Note both keke categories map to the same vehicle type; the difference
 * between them is pooling behaviour, not hardware.
 */
export const RIDE_CATEGORY_VEHICLE_TYPE: Record<RideCategory, VehicleType> = {
  [RideCategory.PRIVATE]: VehicleType.KEKE,
  [RideCategory.SHARED]: VehicleType.KEKE,
  [RideCategory.OKADA]: VehicleType.BIKE,
  [RideCategory.CAR]: VehicleType.CAR,
};

/**
 * Categories that occupy a driver completely.
 *
 * A driver on one of these cannot hold any other active ride, and cannot
 * accept one of these while holding any other active ride. Only SHARED
 * rides pool (up to MAX_ACTIVE_SHARED_RIDES).
 */
export const EXCLUSIVE_CATEGORIES: RideCategory[] = [
  RideCategory.PRIVATE,
  RideCategory.OKADA,
  RideCategory.CAR,
];

/**
 * How many shared keke rides one driver may hold at once
 */
export const MAX_ACTIVE_SHARED_RIDES = 4;

/**
 * Does this vehicle type satisfy this ride category?
 */
export function vehicleTypeMatchesCategory(
  vehicleType: VehicleType,
  category: RideCategory,
): boolean {
  return RIDE_CATEGORY_VEHICLE_TYPE[category] === vehicleType;
}

/**
 * Is this an exclusive (non-poolable) category?
 */
export function isExclusiveCategory(category: RideCategory): boolean {
  return EXCLUSIVE_CATEGORIES.includes(category);
}

/**
 * Given the vehicle types a driver actually operates, return every ride
 * category they are eligible to be offered.
 *
 * Used both for the "available rides" REST query and for deciding which
 * realtime broadcast rooms the driver's socket joins on connect.
 */
export function getAllowedCategoriesForVehicleTypes(
  vehicleTypes: VehicleType[],
): RideCategory[] {
  const owned = new Set(vehicleTypes);

  return (Object.keys(RIDE_CATEGORY_VEHICLE_TYPE) as RideCategory[]).filter(
    (category) => owned.has(RIDE_CATEGORY_VEHICLE_TYPE[category]),
  );
}
