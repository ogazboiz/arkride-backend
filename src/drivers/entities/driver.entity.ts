import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  OneToOne,
} from 'typeorm';
import { Vehicle } from '../../vehicles/entities/vehicle.entity';
import { Ride } from '../../rides/entities/ride.entity';
import { DriverLocation } from '../../driver-locations/entities/driver-location.entity';
import { Role } from '../../common/enums/role.enum';

export enum VerificationStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('drivers')
export class Driver {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  phone: string;

  @Column({ unique: true })
  email: string;

  /**
   * Nullable: a driver who signed up with Privy has no password at all.
   * The login path refuses an account with no password rather than comparing
   * against null.
   */
  @Column({ type: 'varchar', nullable: true })
  password: string | null;

  @Column({ unique: true })
  licenseNumber: string;

  @Column({ type: 'date' })
  licenseExpiry: Date;

  @Column({
    type: 'enum',
    enum: Role,
    default: Role.DRIVER,
  })
  role: Role;

  @Column({
    type: 'enum',
    enum: VerificationStatus,
    default: VerificationStatus.PENDING,
  })
  verificationStatus: VerificationStatus;

  @Column({ type: 'boolean', default: false })
  isOnline: boolean;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 0 })
  ratingAverage: number;

  @Column({ type: 'int', default: 0 })
  totalCompletedRides: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  walletBalance: number;

  /**
   * OTP Code for password reset
   * 
   * Stored when driver requests password reset
   * Cleared after successful password reset
   */
  /**
   * The Privy DID that owns this account, e.g. `did:privy:cm...`.
   *
   * Ark Rides shares one Privy application with the rest of WorldStreet, so
   * this is the same identity a rider already uses on Market Square — one
   * WorldStreet account across products.
   *
   * NULLABLE because email/password accounts predate it and still work; UNIQUE
   * because a DID must resolve to exactly one row. Postgres allows any number
   * of NULLs under a unique constraint, so legacy rows do not collide.
   *
   * Note that `users` and `drivers` are separate tables with separate id
   * spaces. The SAME DID may appear once in each — a person who rides and also
   * drives is one human with two accounts here, which is the existing model;
   * linking Privy does not change it. Which row a token resolves to is decided
   * at sign-in, not guessed per request.
   */
  @Column({ type: 'varchar', unique: true, nullable: true })
  privyDid: string | null;

  /**
   * The driver's embedded EVM wallet, read from a VERIFIED Privy identity
   * token — never from a client-supplied header, which on a public API would
   * let anyone claim any address and redirect a payout.
   *
   * Recorded, not yet settled against: earnings still move through the naira
   * ledger. This is the address KASH payouts will use when that lands, and
   * capturing it now means the data is already there.
   */
  @Column({ type: 'varchar', nullable: true })
  walletAddressEvm: string | null;

  @Column({ type: 'varchar', nullable: true })
  otpCode: string | null;

  /**
   * OTP Expiry timestamp
   * 
   * OTP is valid for 10 minutes from generation
   * Cleared after successful password reset
   */
  @Column({ type: 'timestamp', nullable: true })
  otpExpiry: Date | null;

  // Relationship: One driver can have many vehicles
  @OneToMany(() => Vehicle, (vehicle) => vehicle.driver)
  vehicles: Vehicle[];

  // Relationship: One driver can have many rides
  @OneToMany(() => Ride, (ride) => ride.driver)
  rides: Ride[];

  /**
   * Relationship: One driver has ONE location record
   * 
   * This stores the driver's current GPS position
   * Updated whenever driver sends location update
   * 
   * Example usage:
   * const driver = await driverRepo.findOne({
   *   where: { id: 'driver-uuid' },
   *   relations: ['location']
   * });
   * console.log(driver.location.latitude); // 6.5244
   */
  @OneToOne(() => DriverLocation, (location) => location.driver)
  location: DriverLocation;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
