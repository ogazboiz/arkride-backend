import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import {
  LedgerEntry,
  LedgerEntryType,
  LedgerEntryStatus,
  StakeholderType,
} from './entities/ledger-entry.entity';

/**
 * The shape callers use to write an entry. Status defaults to COMPLETED
 * because most entries (fare splits) settle immediately; gateway-backed
 * movements pass PENDING explicitly and settle later.
 */
export interface WriteLedgerEntry {
  rideId?: string | null;
  type: LedgerEntryType;
  stakeholderType: StakeholderType;
  stakeholderId?: string | null;
  amount: number;
  status?: LedgerEntryStatus;
  providerReference?: string | null;
  metadata?: Record<string, any> | null;
}

/**
 * LedgerService
 *
 * Purpose: Every write to the financial audit trail goes through here.
 *
 * Note the optional EntityManager on the write methods: callers such as
 * RidesService.completeRide() are already inside a transaction and MUST enlist
 * in it, otherwise a rolled-back ride completion would leave orphaned money
 * entries behind.
 */
@Injectable()
export class LedgerService {
  constructor(
    @InjectRepository(LedgerEntry)
    private readonly ledgerRepository: Repository<LedgerEntry>,
  ) {}

  /**
   * Pick the right repository: the caller's transaction if given, ours otherwise
   */
  private repo(manager?: EntityManager): Repository<LedgerEntry> {
    return manager ? manager.getRepository(LedgerEntry) : this.ledgerRepository;
  }

  /**
   * Write one or more entries, optionally inside a caller's transaction
   */
  async writeEntries(
    entries: WriteLedgerEntry[],
    manager?: EntityManager,
  ): Promise<LedgerEntry[]> {
    const repo = this.repo(manager);

    const rows = entries.map((entry) =>
      repo.create({
        rideId: entry.rideId ?? null,
        type: entry.type,
        stakeholderType: entry.stakeholderType,
        stakeholderId: entry.stakeholderId ?? null,
        amount: entry.amount,
        status: entry.status ?? LedgerEntryStatus.COMPLETED,
        providerReference: entry.providerReference ?? null,
        metadata: entry.metadata ?? null,
      }),
    );

    return await repo.save(rows);
  }

  /**
   * Move a pending gateway-backed entry to its final state
   */
  async settleEntry(
    entryId: string,
    status: LedgerEntryStatus,
    providerReference?: string | null,
    metadata?: Record<string, any> | null,
    manager?: EntityManager,
  ): Promise<void> {
    await this.repo(manager).update(entryId, {
      status,
      ...(providerReference !== undefined ? { providerReference } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    });
  }

  /**
   * Every entry produced by one ride — the transparency view the rider and
   * driver both see after completion.
   */
  async findByRideId(rideId: string): Promise<LedgerEntry[]> {
    return await this.ledgerRepository.find({
      where: { rideId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Statement for one stakeholder, newest first
   */
  async findByStakeholder(
    stakeholderType: StakeholderType,
    stakeholderId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ entries: LedgerEntry[]; total: number }> {
    const [entries, total] = await this.ledgerRepository.findAndCount({
      where: { stakeholderType, stakeholderId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { entries, total };
  }

  /**
   * Sum of settled entries of a given type for one stakeholder within a window.
   *
   * Used for the MFB daily fuel allowance, which is derived straight from the
   * ledger rather than tracked in a separate counter that could drift.
   */
  async sumForStakeholder(
    stakeholderType: StakeholderType,
    stakeholderId: string,
    type: LedgerEntryType,
    from: Date,
    to: Date,
    manager?: EntityManager,
  ): Promise<number> {
    const result = await this.repo(manager)
      .createQueryBuilder('entry')
      .select('COALESCE(SUM(entry.amount), 0)', 'total')
      .where('entry.stakeholderType = :stakeholderType', { stakeholderType })
      .andWhere('entry.stakeholderId = :stakeholderId', { stakeholderId })
      .andWhere('entry.type = :type', { type })
      .andWhere('entry.status IN (:...statuses)', {
        statuses: [LedgerEntryStatus.COMPLETED, LedgerEntryStatus.PENDING],
      })
      .andWhere('entry.createdAt BETWEEN :from AND :to', { from, to })
      .getRawOne<{ total: string }>();

    return Number(result?.total ?? 0);
  }

  /**
   * Total platform revenue. No balance column exists for the platform on
   * purpose — the ledger is the only place it lives, so it cannot drift.
   */
  async getPlatformRevenue(): Promise<number> {
    const result = await this.ledgerRepository
      .createQueryBuilder('entry')
      .select('COALESCE(SUM(entry.amount), 0)', 'total')
      .where('entry.stakeholderType = :stakeholderType', {
        stakeholderType: StakeholderType.PLATFORM,
      })
      .andWhere('entry.status = :status', {
        status: LedgerEntryStatus.COMPLETED,
      })
      .getRawOne<{ total: string }>();

    return Number(result?.total ?? 0);
  }

  /**
   * Aggregate view for the admin dashboard
   */
  async getSummary() {
    const rows = await this.ledgerRepository
      .createQueryBuilder('entry')
      .select('entry.type', 'type')
      .addSelect('COALESCE(SUM(entry.amount), 0)', 'total')
      .addSelect('COUNT(*)', 'count')
      .where('entry.status = :status', { status: LedgerEntryStatus.COMPLETED })
      .groupBy('entry.type')
      .getRawMany<{ type: string; total: string; count: string }>();

    return {
      platformRevenue: await this.getPlatformRevenue(),
      byType: rows.map((row) => ({
        type: row.type,
        total: Number(row.total),
        count: Number(row.count),
      })),
    };
  }
}
