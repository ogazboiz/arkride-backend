import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Ride } from '../../rides/entities/ride.entity';
import { User } from '../../users/entities/user.entity';
import { Driver } from '../../drivers/entities/driver.entity';

@Entity('ratings')
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
