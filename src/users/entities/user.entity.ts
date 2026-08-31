import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Ride } from '../../rides/entities/ride.entity';

import { Role } from '../../common/enums/role.enum';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column({ type: 'varchar', unique: true, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', nullable: true })
  password: string | null;

  @Column({ type: 'varchar', nullable: true })
  provider: string | null;

  @Column({ type: 'varchar', nullable: true })
  providerId: string | null;

  @Column({ type: 'varchar', nullable: true })
  otpCode: string | null;

  @Column({ type: 'timestamp', nullable: true })
  otpExpiry: Date | null;

  @Column({ type: 'boolean', default: false })
  isVerified: boolean;

  @Column({
    type: 'enum',
    enum: Role,
    default: Role.USER,
  })
  role: Role;

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 0 })
  ratingAverage: number;

  @Column({ type: 'int', default: 0 })
  totalRides: number;

  @Column({ type: 'boolean', default: false })
  isBlocked: boolean;

  // Relationship: One user can have many rides
  @OneToMany(() => Ride, (ride) => ride.user)
  rides: Ride[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}