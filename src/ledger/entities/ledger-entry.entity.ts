import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * What kind of money movement this entry records
 */
export enum LedgerEntryType {
  RIDE_FARE_DRIVER = 'ride_fare_driver', // 95% of a completed fare
  RIDE_FARE_PLATFORM = 'ride_fare_platform', // 4% commission
  RIDE_FARE_RIDER_CASHBACK = 'ride_fare_rider_cashback', // 1% cashback
  DRIVER_FUEL_SUPPORT_MFB = 'driver_fuel_support_mfb', // MFB refuelling disbursement
  DRIVER_PAYOUT_LINKPAY = 'driver_payout_linkpay', // Withdrawal to the driver's bank
}

/**
 * Whose balance this entry belongs to
 */
export enum StakeholderType {
  DRIVER = 'driver',
  RIDER = 'rider',
  PLATFORM = 'platform',
}

export enum LedgerEntryStatus {
  PENDING = 'pending', // Written, but an external gateway has not confirmed yet
  COMPLETED = 'completed', // Settled
  FAILED = 'failed', // Gateway rejected it; any balance change was reversed
  REVERSED = 'reversed', // Settled, then undone
}

/**
 * LedgerEntry
 *
 * Purpose: The immutable audit trail behind every naira that moves through
 * Ark Rides. Balance columns (Driver.walletBalance, User.cashbackBalance) are
 * fast-read caches; THIS table is the source of truth.
 *
 * Platform revenue deliberately has no balance column — it is
 * SUM(amount) WHERE stakeholderType = 'platform', so there is nothing to drift.
 *
 * SIGN CONVENTION (easy to get backwards, enforce this in review):
 * `amount` is always expressed relative to the stakeholder's OWN balance.
 *   positive => their balance goes up (earning, cashback, fuel disbursement)
 *   negative => their balance goes down (payout withdrawal)
 */
@Entity('ledger_entries')
// One ride can only ever produce one entry of each type. This makes it
// structurally impossible to pay a fare split out twice, even if two
// completeRide() calls somehow race past the app-level guards.
@Index('uq_ledger_ride_type', ['rideId', 'type'], {
  unique: true,
  where: '"rideId" IS NOT NULL',
})
@Index('idx_ledger_stakeholder', ['stakeholderType', 'stakeholderId'])
export class LedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // The ride that produced this entry. Null for payouts and fuel support,
  // which are not tied to any single ride.
  @Column({ type: 'uuid', nullable: true })
  rideId: string | null;

  @Column({ type: 'enum', enum: LedgerEntryType })
  type: LedgerEntryType;

  @Column({ type: 'enum', enum: StakeholderType })
  stakeholderType: StakeholderType;

  // The driver or user id. Null when stakeholderType is PLATFORM.
  @Column({ type: 'uuid', nullable: true })
  stakeholderId: string | null;

  // Signed. See the sign convention note above.
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  @Column({ type: 'varchar', length: 3, default: 'NGN' })
  currency: string;

  @Column({
    type: 'enum',
    enum: LedgerEntryStatus,
    default: LedgerEntryStatus.COMPLETED,
  })
  status: LedgerEntryStatus;

  // Reference returned by an external gateway (LinkPay / MFB)
  @Column({ type: 'varchar', nullable: true })
  providerReference: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;
}
