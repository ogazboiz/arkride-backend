import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Driver } from '../../drivers/entities/driver.entity';

/**
 * DriverLocation Entity
 * 
 * Purpose: Store real-time GPS coordinates for each driver
 * 
 * How it works:
 * - One-to-One relationship with Driver (each driver has ONE location record)
 * - When driver updates location, we UPDATE this record (not create new one)
 * - When driver goes offline, we can optionally delete this record
 * 
 * Database Table: driver_locations
 */
@Entity('driver_locations')
export class DriverLocation {
  /**
   * Unique identifier for this location record
   * Auto-generated UUID
   */
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Reference to the driver who owns this location
   * 
   * Relationship Details:
   * - OneToOne: Each driver has exactly ONE location record
   * - JoinColumn: This table contains the foreign key (driver_id)
   * - onDelete CASCADE: If driver is deleted, delete their location too
   * 
   * Example:
   * driver_locations.driver_id → drivers.id
   */
  @OneToOne(() => Driver, (driver) => driver.location, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'driver_id' })
  driver: Driver;

  /**
   * Latitude coordinate (North-South position)
   * 
   * Range: -90 to +90
   * - Positive values = North of Equator
   * - Negative values = South of Equator
   * - 0 = Equator
   * 
   * precision: 10 total digits
   * scale: 8 digits after decimal (accurate to ~1 millimeter)
   * 
   * Example: 6.52438976 (Lagos, Nigeria)
   */
  @Column('decimal', { precision: 10, scale: 8 })
  latitude: number;

  /**
   * Longitude coordinate (East-West position)
   * 
   * Range: -180 to +180
   * - Positive values = East of Prime Meridian
   * - Negative values = West of Prime Meridian
   * - 0 = Prime Meridian (Greenwich, UK)
   * 
   * precision: 11 total digits (1 extra for values like -180)
   * scale: 8 digits after decimal (accurate to ~1 millimeter)
   * 
   * Example: 3.37920345 (Lagos, Nigeria)
   */
  @Column('decimal', { precision: 11, scale: 8 })
  longitude: number;

  /**
   * When this location was last updated
   * 
   * Auto-updated by TypeORM every time we save changes
   * Used to check if driver's location is stale
   * 
   * Example:
   * If updatedAt is 10 minutes ago, driver might be offline
   */
  @UpdateDateColumn()
  updatedAt: Date;

  /**
   * When this location record was first created
   * Usually when driver first goes online
   */
  @CreateDateColumn()
  createdAt: Date;
}
