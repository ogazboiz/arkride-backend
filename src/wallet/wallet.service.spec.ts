import { BadRequestException } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { LedgerEntryStatus } from '../ledger/entities/ledger-entry.entity';

/**
 * The wallet moves real money against external gateways, so these tests focus
 * on the three ways that can go wrong: spending past a limit, spending money
 * that isn't there, and a gateway failing after the balance already moved.
 */
describe('WalletService', () => {
  let service: WalletService;
  let driverRepository: any;
  let ledgerService: any;
  let redis: any;
  let fuelProvider: any;
  let payoutProvider: any;
  let managedDriver: any;

  const DRIVER_ID = 'driver-1';

  beforeEach(() => {
    managedDriver = { id: DRIVER_ID, walletBalance: 10000, totalCompletedRides: 3 };

    // Mock EntityManager handed to the transaction callback
    const manager = {
      findOne: jest.fn().mockImplementation(async () => managedDriver),
      save: jest.fn().mockImplementation(async (entity) => entity),
    };

    driverRepository = {
      findOne: jest.fn().mockImplementation(async () => managedDriver),
      manager: {
        transaction: jest.fn().mockImplementation(async (cb) => cb(manager)),
      },
    };

    ledgerService = {
      writeEntries: jest.fn().mockResolvedValue([{ id: 'entry-1' }]),
      settleEntry: jest.fn().mockResolvedValue(undefined),
      sumForStakeholder: jest.fn().mockResolvedValue(0),
      findByStakeholder: jest.fn().mockResolvedValue({ entries: [], total: 0 }),
    };

    redis = {
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };

    fuelProvider = {
      disburse: jest.fn().mockResolvedValue({
        success: true,
        providerReference: 'SIM-MFB-1',
        message: 'ok',
      }),
    };

    payoutProvider = {
      initiatePayout: jest.fn().mockResolvedValue({
        success: true,
        providerReference: 'SIM-LINKPAY-1',
        status: 'processing',
        message: 'ok',
      }),
    };

    const configService = {
      get: jest.fn().mockImplementation((key: string) =>
        key === 'MFB_DAILY_FUEL_LIMIT' ? 5000 : undefined,
      ),
    };

    service = new WalletService(
      driverRepository,
      ledgerService,
      configService as any,
      redis,
      fuelProvider,
      payoutProvider,
    );
  });

  describe('fuel support', () => {
    it('reports the remaining daily allowance', async () => {
      ledgerService.sumForStakeholder.mockResolvedValue(1500);

      const limit = await service.getFuelSupportLimit(DRIVER_ID);

      expect(limit).toEqual({ dailyLimit: 5000, usedToday: 1500, remaining: 3500 });
    });

    it('rejects a request that exceeds the daily limit', async () => {
      ledgerService.sumForStakeholder.mockResolvedValue(4500);

      await expect(
        service.requestFuelSupport(DRIVER_ID, { amount: 1000 }),
      ).rejects.toThrow(BadRequestException);

      expect(fuelProvider.disburse).not.toHaveBeenCalled();
    });

    it('credits the wallet and settles the ledger entry on success', async () => {
      await service.requestFuelSupport(DRIVER_ID, { amount: 2000 });

      expect(managedDriver.walletBalance).toBe(12000);
      expect(ledgerService.settleEntry).toHaveBeenCalledWith(
        'entry-1',
        LedgerEntryStatus.COMPLETED,
        'SIM-MFB-1',
        expect.any(Object),
      );
    });

    it('reverses the credit when the bank declines', async () => {
      fuelProvider.disburse.mockResolvedValue({
        success: false,
        providerReference: null,
        message: 'declined',
      });

      await expect(
        service.requestFuelSupport(DRIVER_ID, { amount: 2000 }),
      ).rejects.toThrow(BadRequestException);

      // Credited 2000 then reversed by 2000 — back where it started
      expect(managedDriver.walletBalance).toBe(10000);
      expect(ledgerService.settleEntry).toHaveBeenCalledWith(
        'entry-1',
        LedgerEntryStatus.FAILED,
        null,
        expect.objectContaining({ reversed: true }),
        expect.anything(),
      );
    });

    it('releases the redis lock even when the request fails', async () => {
      ledgerService.sumForStakeholder.mockResolvedValue(5000);

      await expect(
        service.requestFuelSupport(DRIVER_ID, { amount: 1000 }),
      ).rejects.toThrow(BadRequestException);

      expect(redis.del).toHaveBeenCalled();
    });

    it('refuses a concurrent request while one is in flight', async () => {
      redis.set.mockResolvedValue(null); // lock already held

      await expect(
        service.requestFuelSupport(DRIVER_ID, { amount: 1000 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('payouts', () => {
    it('rejects a payout larger than the balance', async () => {
      await expect(
        service.requestPayout(DRIVER_ID, {
          amount: 50000,
          bankAccount: { accountNumber: '0123456789', bankCode: '058' },
        }),
      ).rejects.toThrow(BadRequestException);

      expect(payoutProvider.initiatePayout).not.toHaveBeenCalled();
      expect(managedDriver.walletBalance).toBe(10000);
    });

    it('debits the wallet and leaves the entry pending while settling', async () => {
      await service.requestPayout(DRIVER_ID, {
        amount: 4000,
        bankAccount: { accountNumber: '0123456789', bankCode: '058' },
      });

      expect(managedDriver.walletBalance).toBe(6000);
      expect(ledgerService.settleEntry).toHaveBeenCalledWith(
        'entry-1',
        LedgerEntryStatus.PENDING,
        'SIM-LINKPAY-1',
        expect.any(Object),
      );
    });

    it('records the payout as a negative amount', async () => {
      await service.requestPayout(DRIVER_ID, {
        amount: 4000,
        bankAccount: { accountNumber: '0123456789', bankCode: '058' },
      });

      const [[entries]] = ledgerService.writeEntries.mock.calls;
      expect(entries[0].amount).toBe(-4000);
    });

    it('gives the money back when the gateway fails', async () => {
      payoutProvider.initiatePayout.mockResolvedValue({
        success: false,
        providerReference: null,
        status: 'failed',
        message: 'bank unreachable',
      });

      await expect(
        service.requestPayout(DRIVER_ID, {
          amount: 4000,
          bankAccount: { accountNumber: '0123456789', bankCode: '058' },
        }),
      ).rejects.toThrow(BadRequestException);

      expect(managedDriver.walletBalance).toBe(10000);
    });

    it('stores only the last four digits of the account number', async () => {
      await service.requestPayout(DRIVER_ID, {
        amount: 1000,
        bankAccount: { accountNumber: '0123456789', bankCode: '058' },
      });

      const [[entries]] = ledgerService.writeEntries.mock.calls;
      expect(entries[0].metadata.accountNumber).toBe('******6789');
    });
  });
});
