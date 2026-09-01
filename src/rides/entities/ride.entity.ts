import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Driver } from '../../drivers/entities/driver.entity';
import { Vehicle } from '../../vehicles/entities/vehicle.entity';

/**
 * Enum for tracking the current status of a ride
 * Flow: requested → accepted → arrived → in_progress → completed
 * Can be cancelled at any point
 */
export enum RideStatus {
  REQUESTED = 'requested',     // User has requested a ride
  ACCEPTED = 'accepted',       // Driver has accepted the ride
  ARRIVED = 'arrived',         // Driver has arrived at pickup location
  IN_PROGRESS = 'in_progress', // Ride is currently ongoing
  COMPLETED = 'completed',     // Ride has been completed successfully
  CANCELLED = 'cancelled',     // Ride has been cancelled by user or driver
}

/**
 * Enum for ride categories
 * Determines pricing and driver matching
 */
export enum RideCategory {
  PRIVATE = 'private', // Whole Keke
  SHARED = 'shared',   // Shared Keke (max 4 people)
  OKADA = 'okada',     // Motorcycle
  CAR = 'car',         // Car (exclusive, like Private)
}

/**
 * Where a ride was booked from.
 *
 * Kept for attribution: the omnichannel entry points (a WhatsApp agent, a voice
 * IVR) funnel into the same booking path as the app, so without this column
 * there would be no way to tell afterwards which channel actually drove volume.
 */
export enum RideOriginChannel {
  APP = 'app',
  WHATSAPP = 'whatsapp',
  VOICE = 'voice',
}

/**
 * Location interface for storing pickup and dropoff coordinates
 */
export interface Location {
  address: string; // Full address string
  lat: number;     // Latitude coordinate
  lng: number;     // Longitude coordinate
}

/**
 * Ride Entity
 * Represents a single ride request from a user to be fulfilled by a driver
 */
@Entity('rides')
export class Ride {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Foreign key to the user who requested the ride
  @Column({ type: 'uuid' })
  userId: string;

  // Relationship to User entity
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  // Foreign key to the driver assigned to this ride (nullable until accepted)
  @Column({ type: 'uuid', nullable: true })
  driverId: string | null;

  // Relationship to Driver entity
  @ManyToOne(() => Driver, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'driverId' })
  driver: Driver | null;

  // Foreign key to the vehicle used for this ride (nullable until accepted)
  @Column({ type: 'uuid', nullable: true })
  vehicleId: string | null;

  // Relationship to Vehicle entity
  @ManyToOne(() => Vehicle, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'vehicleId' })
  vehicle: Vehicle | null;

  // Pickup location stored as JSON object with address, lat, lng
  @Column({ type: 'jsonb' })
  pickup: Location;

  // Dropoff location stored as JSON object with address, lat, lng
  @Column({ type: 'jsonb' })
  dropoff: Location;

  // Distance in kilometers (calculated from pickup to dropoff)
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  distanceKm: number | null;

  // Ride category (Private, Shared, Okada)
  @Column({
    type: 'enum',
    enum: RideCategory,
    default: RideCategory.PRIVATE,
  })
  category: RideCategory;

  // Estimated fare calculated before ride starts
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  estimatedFare: number | null;

  // Final fare charged after ride completion
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  finalFare: number | null;

  // Current status of the ride
  @Column({
    type: 'enum',
    enum: RideStatus,
    default: RideStatus.REQUESTED,
  })
  status: RideStatus;

  // Which entry point this booking came through (app, WhatsApp agent, voice)
  @Column({
    type: 'enum',
    enum: RideOriginChannel,
    default: RideOriginChannel.APP,
  })
  originChannel: RideOriginChannel;

  // Reason for cancellation (if ride was cancelled)
  @Column({ type: 'text', nullable: true })
  cancellationReason: string | null;

  // Timestamp when ride was requested by user
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  requestedAt: Date;

  // Timestamp when driver accepted the ride
  @Column({ type: 'timestamp', nullable: true })
  acceptedAt: Date | null;

  // Timestamp when ride actually started (driver clicked "start ride")
  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date | null;

  // Timestamp when ride was completed
  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;

  // Auto-generated timestamp for when the record was created
  @CreateDateColumn()
  createdAt: Date;

  // Auto-generated timestamp for when the record was last updated
  @UpdateDateColumn()
  updatedAt: Date;
}
