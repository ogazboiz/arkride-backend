import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Ride } from '../../rides/entities/ride.entity';

/**
 * Who pressed the button
 */
export enum EmergencyTriggeredBy {
  RIDER = 'rider',
  DRIVER = 'driver',
}

export enum EmergencyStatus {
  ACTIVE = 'active',
  RESOLVED = 'resolved',
  FALSE_ALARM = 'false_alarm',
}

/**
 * EmergencyIncident
 *
 * A permanent record of every SOS raised during a ride. Written before any
 * notification is attempted, so an incident exists even if every downstream
 * webhook and socket delivery fails.
 */
@Entity('emergency_incidents')
@Index('idx_emergency_ride', ['rideId'])
@Index('idx_emergency_status', ['status'])
export class EmergencyIncident {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  rideId: string;

  @ManyToOne(() => Ride, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'rideId' })
  ride: Ride;

  @Column({ type: 'enum', enum: EmergencyTriggeredBy })
  triggeredBy: EmergencyTriggeredBy;

  // The user id or driver id of whoever raised it
  @Column({ type: 'uuid' })
  triggeredById: string;

  /**
   * Best known position at the moment of the alert.
   *
   * Nullable on purpose: an SOS must never fail because the driver's GPS was
   * momentarily stale. A recorded alert with no coordinates beats no alert.
   */
  @Column({ type: 'jsonb', nullable: true })
  location: { lat: number; lng: number; address?: string } | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({
    type: 'enum',
    enum: EmergencyStatus,
    default: EmergencyStatus.ACTIVE,
  })
  status: EmergencyStatus;

  @Column({ type: 'text', nullable: true })
  resolutionNote: string | null;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
