/**
 * External Financial Gateway Contracts
 *
 * Purpose: Describe what Ark Rides needs from a microfinance bank and from a
 * payout gateway, without committing to either vendor's API shape.
 *
 * Why interfaces rather than direct clients:
 * Live MFB and LinkPay credentials do not exist yet. The simulated
 * implementations satisfy these contracts today, and a real HTTP client can be
 * dropped in later by binding a different class in wallet.module.ts — no caller
 * changes, because callers only ever see these two interfaces.
 */

export const FUEL_SUPPORT_PROVIDER = 'FUEL_SUPPORT_PROVIDER';
export const PAYOUT_PROVIDER = 'PAYOUT_PROVIDER';

export interface FuelSupportRequest {
  driverId: string;
  amount: number;
  reference: string;
}

export interface FuelSupportResult {
  success: boolean;
  providerReference: string | null;
  message: string;
  raw?: Record<string, any>;
}

/**
 * A microfinance bank that fronts drivers their daily refuelling money
 */
export interface FuelSupportProvider {
  disburse(request: FuelSupportRequest): Promise<FuelSupportResult>;
}

export interface PayoutRequest {
  driverId: string;
  amount: number;
  reference: string;
  bankAccount: {
    accountNumber: string;
    bankCode: string;
    accountName?: string;
  };
}

export interface PayoutResult {
  success: boolean;
  providerReference: string | null;
  status: 'completed' | 'processing' | 'failed';
  message: string;
  raw?: Record<string, any>;
}

/**
 * A payout gateway that moves a driver's earnings to their bank
 */
export interface PayoutProvider {
  initiatePayout(request: PayoutRequest): Promise<PayoutResult>;
}
