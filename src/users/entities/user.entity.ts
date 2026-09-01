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
  walletAddressEvm: string | null;

  @Column({ type: 'varchar', nullable: true })
  walletAddressSolana: string | null;

  @Column({ type: 'varchar', nullable: true })
  walletAddressTron: string | null;

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

  /**
   * Accumulated 1% cashback from completed rides.
   *
   * Fast-read cache — the authoritative record of every credit is the
   * ledger_entries table.
   */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  cashbackBalance: number;

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