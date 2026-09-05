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
import { User } from '../../users/entities/user.entity';
import { Driver } from '../../drivers/entities/driver.entity';

/**
 * One rating per person per ride.
 *
 * Without this constraint the same rater could POST the same ride and ratee
 * repeatedly; each write re-ran AVG() over the ratings table, so a driver
 * could lift their own `ratingAverage` to 5.00 with a loop, and a rider could
 * drive a driver's to 1.00 the same way. The app-level duplicate check in
 * RatingsService is the friendly error; THIS is what makes it true under
 * concurrency.
 */
@Entity('ratings')
@Index('uq_rating_ride_rater', ['rideId', 'raterId'], { unique: true })
@Index('idx_rating_ratee', ['rateeId', 'rateeType'])
export class Rating {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  rideId: string;

  @ManyToOne(() => Ride)
  @JoinColumn({ name: 'rideId' })
  ride: Ride;

  @Column({ type: 'uuid' })
  raterId: string;

  @Column({ type: 'uuid' })
  rateeId: string;

  @Column({ type: 'varchar' })
  rateeType: 'user' | 'driver';

  @Column({ type: 'int' })
  rating: number;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
