import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyAccessToken, verifyIdentityToken } from '@privy-io/node';

/**
 * Privy identity verification.
 *
 * Ark Rides shares one Privy application with the rest of WorldStreet
 * (Market Square, Trade, Earn), so a rider who already has a WorldStreet
 * account signs into Ark Rides with the identity they already have. The trust
 * model is the one apps/market-square uses, and this is deliberately a close
 * relative of that implementation rather than a new invention.
 *
 * TWO TOKENS, TWO JOBS — this is the part that is easy to get wrong:
 *
 *   ACCESS token  (Authorization: Bearer …)
 *     Proves WHO the caller is. Its `sub` is the Privy DID. That is all it
 *     carries; there is no wallet in it.
 *
 *   IDENTITY token (privy-id-token header)
 *     Carries the user's linked accounts, including their embedded wallet.
 *     It is VERIFIED with the same app key rather than trusted, because the
 *     wallet must not come from a plain header: this API is public, and a
 *     header would let anyone claim any address.
 *
 * Both are ES256, issued by `privy.io`, and audience-bound to the app id.
 * Verification is offline against the app's public key — no network call, so
 * an outage at Privy does not take sign-in with it.
 */
@Injectable()
export class PrivyService {
  private readonly logger = new Logger(PrivyService.name);

  private readonly appId: string | undefined;
  private readonly verificationKey: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.appId = config.get<string>('PRIVY_APP_ID')?.trim() || undefined;
    // Env files carry the PEM with literal backslash-n. jose needs real
    // newlines, and an unconverted key fails with a confusing parse error
    // rather than an obviously-wrong-key one.
    this.verificationKey =
      config.get<string>('PRIVY_VERIFICATION_KEY')?.replace(/\\n/g, '\n') ||
      undefined;

    if (!this.isConfigured) {
      this.logger.warn(
        'Privy is not configured (PRIVY_APP_ID / PRIVY_VERIFICATION_KEY). ' +
          'Privy sign-in will be refused; email/password login is unaffected.',
      );
    }
  }

  /**
   * Whether Privy sign-in can work at all.
   *
   * Callers check this and return a clear 503 rather than letting every
   * verification fail as "invalid token", which would send a client hunting
   * for a problem with their token instead of with the deployment.
   */
  get isConfigured(): boolean {
    return Boolean(this.appId && this.verificationKey);
  }

  /**
   * The Privy DID behind an access token, or null.
   *
   * Null on ANY failure — malformed, expired, wrong audience, wrong issuer,
   * signed by a different key. Never throws, and never says which of those it
   * was: distinguishing "expired" from "wrong app" for an unauthenticated
   * caller is free reconnaissance.
   */
  async verifyAccessToken(token: string): Promise<string | null> {
    if (!this.isConfigured || !token) return null;

    try {
      const claims = await verifyAccessToken({
        access_token: token,
        app_id: this.appId as string,
        verification_key: this.verificationKey as string,
      });
      return claims.user_id || null;
    } catch (error) {
      this.logger.debug({
        message: 'Privy access token verification failed',
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * The caller's embedded EVM wallet, read from a VERIFIED identity token.
   *
   * Null on any failure, deliberately not a throw: this runs alongside an
   * already-authenticated request purely to keep a wallet address current, and
   * a stale or absent identity token must not lock a rider out of booking.
   */
  async walletFromIdentityToken(
    token: string | null | undefined,
  ): Promise<string | null> {
    if (!this.isConfigured || !token) return null;

    try {
      const user = await verifyIdentityToken({
        identity_token: token,
        app_id: this.appId as string,
        verification_key: this.verificationKey as string,
      });
      return walletFromLinkedAccounts(
        (user as { linked_accounts?: unknown }).linked_accounts,
      );
    } catch (error) {
      this.logger.debug({
        message: 'Privy identity token verification failed',
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

/** Header Privy's client SDK sends the signed identity token in. */
export const PRIVY_IDENTITY_HEADER = 'privy-id-token';

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/u;

interface LinkedAccount {
  type?: string;
  address?: string;
  chain_type?: string;
  chainType?: string;
  wallet_client_type?: string;
  walletClientType?: string;
}

/**
 * Pick the user's EVM wallet out of a verified token's linked accounts.
 *
 * Three things this has to survive, all of them real:
 *
 *  - Privy sometimes hands `linked_accounts` back as a JSON STRING rather than
 *    an array, so it is parsed before it is filtered.
 *  - The server SDK spells these `chain_type` / `wallet_client_type` while the
 *    React SDK spells them `chainType` / `walletClientType`. Both are accepted.
 *  - A user may have an embedded wallet, an externally linked one (MetaMask),
 *    both, or neither. The embedded one wins; an external one is used only
 *    when there is no embedded wallet, so a rider who linked only MetaMask
 *    still has somewhere for a payout to land.
 *
 * Lower-cased on the way out, because addresses are compared
 * case-insensitively everywhere downstream and storing one casing while
 * comparing another is how a wallet quietly stops matching itself.
 *
 * Exported so the unit test can build payloads by hand.
 */
export function walletFromLinkedAccounts(claim: unknown): string | null {
  let accounts: unknown = claim;

  if (typeof accounts === 'string') {
    try {
      accounts = JSON.parse(accounts);
    } catch {
      return null;
    }
  }

  if (!Array.isArray(accounts)) return null;

  const wallets = (accounts as LinkedAccount[]).filter(
    (account) =>
      account &&
      account.type === 'wallet' &&
      (account.chain_type ?? account.chainType) === 'ethereum' &&
      typeof account.address === 'string' &&
      EVM_ADDRESS.test(account.address),
  );

  const embedded =
    wallets.find(
      (account) =>
        (account.wallet_client_type ?? account.walletClientType) === 'privy',
    ) ?? wallets[0];

  return embedded?.address ? embedded.address.toLowerCase() : null;
}
