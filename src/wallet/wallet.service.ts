import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { randomUUID } from 'crypto';
import { Driver } from '../drivers/entities/driver.entity';
import { LedgerService } from '../ledger/ledger.service';
import {
  LedgerEntryType,
  LedgerEntryStatus,
  StakeholderType,
} from '../ledger/entities/ledger-entry.entity';
import { REDIS_CLIENT, WALLET_LOCK_PREFIX } from '../redis/redis.constants';
import {
  FUEL_SUPPORT_PROVIDER,
  PAYOUT_PROVIDER,
} from './providers/gateway.interfaces';
import type {
  FuelSupportProvider,
  PayoutProvider,
} from './providers/gateway.interfaces';
import { RequestFuelSupportDto, RequestPayoutDto } from './dto/wallet.dto';
import { toKobo, toNaira } from '../common/utils/money.util';

/**
 * WalletService
 *
 * Purpose: The driver's money — earnings balance, MFB fuel advances, and
 * LinkPay withdrawals.
 *
 * The ordering in these methods is deliberate and load-bearing:
 *
 *   Redis lock  →  DB transaction (validate, move balance, write PENDING entry)
 *               →  commit
 *               →  call the external gateway
 *               →  settle or reverse
 *
 * The gateway call happens strictly AFTER the commit. Holding a Postgres
 * transaction open across a third-party HTTP call would pin a pooled connection
 * for the length of someone else's outage.
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectRepository(Driver)
    private readonly driverRepository: Repository<Driver>,
    private readonly ledgerService: LedgerService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(FUEL_SUPPORT_PROVIDER)
    private readonly fuelSupportProvider: FuelSupportProvider,
    @Inject(PAYOUT_PROVIDER)
    private readonly payoutProvider: PayoutProvider,
  ) {}

  private get dailyFuelLimit(): number {
    return Number(this.configService.get('MFB_DAILY_FUEL_LIMIT') ?? 5000);
  }

  /**
   * Start and end of today, for the rolling daily fuel allowance
   */
  private todayWindow(): { from: Date; to: Date } {
    const from = new Date();
    from.setHours(0, 0, 0, 0);

    const to = new Date();
    to.setHours(23, 59, 59, 999);

    return { from, to };
  }

  /**
   * Current wallet position plus today's remaining fuel allowance
   */
  async getBalance(driverId: string) {
    const driver = await this.driverRepository.findOne({
      where: { id: driverId },
    });
    if (!driver) throw new NotFoundException('Driver not found');

    const fuelSupport = await this.getFuelSupportLimit(driverId);

    return {
      driverId,
      walletBalance: Number(driver.walletBalance || 0),
      totalCompletedRides: driver.totalCompletedRides,
      fuelSupport,
    };
  }

  /**
   * How much fuel support is left today.
   *
   * Derived by summing the ledger rather than from a counter column — the
   * ledger is already the source of truth, and a second counter would be one
   * more thing that can drift out of sync with it.
   */
  async getFuelSupportLimit(driverId: string) {
    const { from, to } = this.todayWindow();

    const usedToday = await this.ledgerService.sumForStakeholder(
      StakeholderType.DRIVER,
      driverId,
      LedgerEntryType.DRIVER_FUEL_SUPPORT_MFB,
      from,
      to,
    );

    const dailyLimit = this.dailyFuelLimit;

    return {
      dailyLimit,
      usedToday,
      remaining: Math.max(0, dailyLimit - usedToday),
    };
  }

  /**
   * Request a fuel advance from the microfinance bank.
   */
  async requestFuelSupport(driverId: string, dto: RequestFuelSupportDto) {
    const lockKey = `${WALLET_LOCK_PREFIX}fuel:${driverId}`;
    const lockAcquired = await this.redis.set(lockKey, '1', 'EX', 15, 'NX');

    if (!lockAcquired) {
      throw new BadRequestException(
        'A fuel support request is already being processed. Please wait.',
      );
    }

    const reference = `fuel_${randomUUID()}`;

    try {
      // --- Phase 1: reserve the money and record intent, atomically ---
      const entryId = await this.driverRepository.manager.transaction(
        async (manager) => {
          const driver = await manager.findOne(Driver, {
            where: { id: driverId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!driver) throw new NotFoundException('Driver not found');

          const { from, to } = this.todayWindow();
          const usedToday = await this.ledgerService.sumForStakeholder(
            StakeholderType.DRIVER,
            driverId,
            LedgerEntryType.DRIVER_FUEL_SUPPORT_MFB,
            from,
            to,
            manager,
          );

          const remaining = this.dailyFuelLimit - usedToday;
          if (dto.amount > remaining) {
            throw new BadRequestException(
              `Daily fuel support limit exceeded. You have ₦${remaining} of ₦${this.dailyFuelLimit} left today.`,
            );
          }

          // Credit optimistically so the driver can refuel immediately;
          // reversed below if the bank declines.
          driver.walletBalance =
            Number(driver.walletBalance || 0) + toNaira(toKobo(dto.amount));
          await manager.save(driver);

          const [entry] = await this.ledgerService.writeEntries(
            [
              {
                type: LedgerEntryType.DRIVER_FUEL_SUPPORT_MFB,
                stakeholderType: StakeholderType.DRIVER,
                stakeholderId: driverId,
                amount: dto.amount,
                status: LedgerEntryStatus.PENDING,
                metadata: { reference, dailyLimit: this.dailyFuelLimit },
              },
            ],
            manager,
          );

          return entry.id;
        },
      );

      // --- Phase 2: talk to the bank, outside the transaction ---
      const result = await this.fuelSupportProvider.disburse({
        driverId,
        amount: dto.amount,
        reference,
      });

      if (!result.success) {
        await this.reverseDriverBalance(
          driverId,
          -dto.amount,
          entryId,
          result.message,
        );
        throw new BadRequestException(
          `Fuel support declined by the bank: ${result.message}`,
        );
      }

      await this.ledgerService.settleEntry(
        entryId,
        LedgerEntryStatus.COMPLETED,
        result.providerReference,
        { reference, provider: result.raw },
      );

      const balance = await this.getBalance(driverId);

      return {
        message: result.message,
        amount: dto.amount,
        providerReference: result.providerReference,
        ...balance,
      };
    } finally {
      await this.redis.del(lockKey);
    }
  }

  /**
   * Withdraw earnings to a bank account through LinkPay.
   */
  async requestPayout(driverId: string, dto: RequestPayoutDto) {
    const lockKey = `${WALLET_LOCK_PREFIX}payout:${driverId}`;
    const lockAcquired = await this.redis.set(lockKey, '1', 'EX', 15, 'NX');

    if (!lockAcquired) {
      throw new BadRequestException(
        'A payout is already being processed. Please wait.',
      );
    }

    const reference = `payout_${randomUUID()}`;

    try {
      // --- Phase 1: debit and record intent, atomically ---
      const entryId = await this.driverRepository.manager.transaction(
        async (manager) => {
          const driver = await manager.findOne(Driver, {
            where: { id: driverId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!driver) throw new NotFoundException('Driver not found');

          const balance = Number(driver.walletBalance || 0);
          if (dto.amount > balance) {
            throw new BadRequestException(
              `Insufficient balance. You have ₦${balance} available.`,
            );
          }

          driver.walletBalance = toNaira(toKobo(balance) - toKobo(dto.amount));
          await manager.save(driver);

          // Negative: a payout reduces the driver's balance
          const [entry] = await this.ledgerService.writeEntries(
            [
              {
                type: LedgerEntryType.DRIVER_PAYOUT_LINKPAY,
                stakeholderType: StakeholderType.DRIVER,
                stakeholderId: driverId,
                amount: -Math.abs(dto.amount),
                status: LedgerEntryStatus.PENDING,
                metadata: {
                  reference,
                  bankCode: dto.bankAccount.bankCode,
                  // Only the last 4 digits are retained
                  accountNumber: `******${dto.bankAccount.accountNumber.slice(-4)}`,
                },
              },
            ],
            manager,
          );

          return entry.id;
        },
      );

      // --- Phase 2: submit to the gateway, outside the transaction ---
      const result = await this.payoutProvider.initiatePayout({
        driverId,
        amount: dto.amount,
        reference,
        bankAccount: dto.bankAccount,
      });

      if (!result.success || result.status === 'failed') {
        // Give the money back — the withdrawal never happened
        await this.reverseDriverBalance(
          driverId,
          dto.amount,
          entryId,
          result.message,
        );
        throw new BadRequestException(`Payout failed: ${result.message}`);
      }

      // A payout that is still settling stays PENDING in the ledger; the
      // balance has already moved, which is correct — the money is committed.
      await this.ledgerService.settleEntry(
        entryId,
        result.status === 'completed'
          ? LedgerEntryStatus.COMPLETED
          : LedgerEntryStatus.PENDING,
        result.providerReference,
        { reference, provider: result.raw },
      );

      const balance = await this.getBalance(driverId);

      return {
        message: result.message,
        amount: dto.amount,
        status: result.status,
        providerReference: result.providerReference,
        ...balance,
      };
    } finally {
      await this.redis.del(lockKey);
    }
  }

  /**
   * Undo an optimistic balance change after a gateway rejection, and mark the
   * ledger entry failed so the audit trail records the attempt.
   *
   * `delta` is applied to the driver's balance: positive gives money back
   * (failed payout), negative takes it away (failed fuel disbursement).
   */
  private async reverseDriverBalance(
    driverId: string,
    delta: number,
    entryId: string,
    reason: string,
  ): Promise<void> {
    await this.driverRepository.manager.transaction(async (manager) => {
      const driver = await manager.findOne(Driver, {
        where: { id: driverId },
        lock: { mode: 'pessimistic_write' },
      });

      if (driver) {
        driver.walletBalance = toNaira(
          toKobo(Number(driver.walletBalance || 0)) + toKobo(delta),
        );
        await manager.save(driver);
      }

      await this.ledgerService.settleEntry(
        entryId,
        LedgerEntryStatus.FAILED,
        null,
        { reversed: true, reason },
        manager,
      );
    });

    this.logger.warn(
      `↩️  Reversed ₦${Math.abs(delta)} for driver ${driverId} after gateway failure: ${reason}`,
    );
  }

  /**
   * Paginated statement of this driver's money movements
   */
  async getTransactions(driverId: string, limit = 50, offset = 0) {
    const { entries, total } = await this.ledgerService.findByStakeholder(
      StakeholderType.DRIVER,
      driverId,
      limit,
      offset,
    );

    return { count: entries.length, total, transactions: entries };
  }
}
