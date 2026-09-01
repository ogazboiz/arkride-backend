import { Ride } from '../../rides/entities/ride.entity';

/**
 * Realtime Event Catalogue
 *
 * Purpose: One shared definition of every event name and payload shape that
 * crosses the wire, imported by both the emitting services and the gateway so
 * the two cannot drift apart silently.
 *
 * Two layers of names, deliberately kept distinct:
 *
 * 1. RIDE_EVENTS — internal EventEmitter2 topics. Services emit these. This
 *    indirection is what keeps RidesService from ever importing the gateway
 *    (and the gateway from importing RidesService), so there is no circular
 *    dependency between the domain and the transport.
 *
 * 2. WS_EVENTS — what clients actually subscribe to over socket.io.
 */

/** Internal application events (EventEmitter2) */
export const RIDE_EVENTS = {
  REQUESTED: 'ride.requested',
  ACCEPTED: 'ride.accepted',
  ARRIVED: 'ride.arrived',
  STARTED: 'ride.started',
  COMPLETED: 'ride.completed',
  CANCELLED: 'ride.cancelled',
  DRIVER_LOCATION_UPDATED: 'driver.location_updated',
  EMERGENCY_TRIGGERED: 'emergency.triggered',
} as const;

/** Events pushed to socket.io clients */
export const WS_EVENTS = {
  RIDE_REQUESTED: 'ride:requested',
  RIDE_ACCEPTED: 'ride:accepted',
  RIDE_ARRIVED: 'ride:arrived',
  RIDE_STARTED: 'ride:started',
  RIDE_COMPLETED: 'ride:completed',
  RIDE_CANCELLED: 'ride:cancelled',
  RIDE_TAKEN: 'ride:taken', // Tells other drivers to drop it from their list
  DRIVER_LOCATION: 'driver:location',
  SOS_TRIGGERED: 'sos:triggered',
  AUTH_ERROR: 'auth:error',
} as const;

/** Messages clients may send to the server */
export const WS_CLIENT_EVENTS = {
  JOIN_RIDE: 'join:ride',
  LEAVE_RIDE: 'leave:ride',
} as const;

/**
 * Room naming. Kept in one place so the gateway and any future
 * broadcaster address the same rooms.
 */
export const ROOMS = {
  ride: (rideId: string) => `ride:${rideId}`,
  user: (userId: string) => `user:${userId}`,
  driver: (driverId: string) => `driver:${driverId}`,
  availableRides: (category: string) => `available-rides:${category}`,
  opsEmergency: () => 'ops:emergency',
};

/** Emitted whenever a ride changes state */
export interface RideStateEvent {
  ride: Ride;
}

/** Emitted on completion, carrying the transparent revenue breakdown */
export interface RideCompletedEvent extends RideStateEvent {
  split: {
    totalFare: number;
    driverEarning: number;
    platformCommission: number;
    riderCashback: number;
  };
}

/** Emitted when a driver on an active ride sends a GPS ping */
export interface DriverLocationEvent {
  driverId: string;
  rideId: string;
  latitude: number;
  longitude: number;
  updatedAt: Date;
}

/** Emitted when an SOS is raised mid-ride */
export interface EmergencyEvent {
  incidentId: string;
  rideId: string;
  triggeredBy: 'rider' | 'driver';
  triggeredById: string;
  location: { lat: number; lng: number; address?: string } | null;
  createdAt: Date;
  // Both parties are named explicitly so the alert can be addressed directly
  // to each of them, not only to the ride room they may not have joined.
  userId?: string;
  driverId?: string | null;
}
