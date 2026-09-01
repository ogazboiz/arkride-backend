import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  FuelSupportProvider,
  FuelSupportRequest,
  FuelSupportResult,
  PayoutProvider,
  PayoutRequest,
  PayoutResult,
} from './gateway.interfaces';

/**
 * SimulatedMfbProvider
 *
 * Stands in for the microfinance bank until real credentials exist.
 *
 * Everything around it is real — the daily allowance check, the wallet credit,
 * the ledger entry, the reversal path on failure. Only the network call to the
 * bank is faked, so swapping in the live client later exercises code that has
 * already been running in anger.
 */
@Injectable()
export class SimulatedMfbProvider implements FuelSupportProvider {
  private readonly logger = new Logger(SimulatedMfbProvider.name);

  async disburse(request: FuelSupportRequest): Promise<FuelSupportResult> {
    const providerReference = `SIM-MFB-${randomUUID()}`;

    this.logger.log(
      `⛽ [SIMULATED MFB] Disbursed ₦${request.amount} to driver ${request.driverId} (ref ${providerReference})`,
    );

    return {
      success: true,
      providerReference,
      message: 'Fuel support disbursed (simulated)',
      raw: {
        simulated: true,
        requestReference: request.reference,
        disbursedAt: new Date().toISOString(),
      },
    };
  }
}

/**
 * SimulatedLinkPayProvider
 *
 * Stands in for the LinkPay payout gateway. Returns `processing` rather than
 * `completed`, because that is what a real payout API does — money lands
 * asynchronously — and building against the optimistic case would hide the
 * pending-settlement state the ledger already models.
 */
@Injectable()
export class SimulatedLinkPayProvider implements PayoutProvider {
  private readonly logger = new Logger(SimulatedLinkPayProvider.name);

  async initiatePayout(request: PayoutRequest): Promise<PayoutResult> {
    const providerReference = `SIM-LINKPAY-${randomUUID()}`;

    this.logger.log(
      `🏦 [SIMULATED LINKPAY] Payout of ₦${request.amount} for driver ${request.driverId} ` +
        `to ${request.bankAccount.bankCode}/${request.bankAccount.accountNumber} (ref ${providerReference})`,
    );

    return {
      success: true,
      providerReference,
      status: 'processing',
      message: 'Payout submitted to LinkPay (simulated)',
      raw: {
        simulated: true,
        requestReference: request.reference,
        submittedAt: new Date().toISOString(),
      },
    };
  }
}
