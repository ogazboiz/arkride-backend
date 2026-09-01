import {
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DecaneClient,
  DecaneClaims,
  DecaneUser,
  DecaneAddresses,
  DecaneAuthResult,
  DecaneAuthError,
  DecaneApiError,
} from 'decane-node';

@Injectable()
export class DecaneService implements OnModuleInit {
  private readonly logger = new Logger(DecaneService.name);
  private decane: DecaneClient;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const appId = this.configService.get<string>('DECANE_APP_ID');
    const verificationKey = this.configService.get<string>('DECANE_VERIFICATION_KEY');
    const apiKey = this.configService.get<string>('DECANE_API_KEY');
    const apiBase = this.configService.get<string>('DECANE_API_BASE');

    this.decane = new DecaneClient({
      appId: appId || undefined,
      verificationKey: verificationKey || undefined,
      apiKey: apiKey || undefined,
      apiBase: apiBase || undefined,
    });

    this.logger.log(
      `DecaneClient initialized (appId: ${appId ?? 'unscoped'}, mode: ${
        verificationKey ? 'static-key (offline)' : 'JWKS (remote)'
      })`,
    );
  }

  /**
   * Verify an ES256 Decane access token.
   * Throws UnauthorizedException on signature, expiry, or project mismatch.
   */
  async verifyAccessToken(token: string): Promise<DecaneClaims> {
    try {
      return await this.decane.verifyAccessToken(token);
    } catch (err) {
      if (err instanceof DecaneAuthError) {
        this.logger.warn(`Decane token verification failed: ${err.reason}`);
        throw new UnauthorizedException(`Decane verification failed: ${err.reason}`);
      }
      throw err;
    }
  }

  /**
   * Safe verification returning null for invalid tokens without throwing DecaneAuthError.
   */
  async safeVerifyAccessToken(token: string): Promise<DecaneClaims | null> {
    return this.decane.safeVerifyAccessToken(token);
  }

  /**
   * Fetches public wallet addresses ({ evm, solana, tron }) for the token owner.
   */
  async getAddresses(token: string): Promise<DecaneAddresses> {
    try {
      return await this.decane.getAddresses(token);
    } catch (err) {
      if (err instanceof DecaneAuthError) {
        throw new UnauthorizedException(`Failed to resolve addresses: ${err.reason}`);
      }
      throw err;
    }
  }

  /**
   * Verifies the token and resolves user ID and wallet addresses in one step.
   * Addresses are best-effort (null if not yet created).
   */
  async getUser(token: string): Promise<DecaneUser> {
    try {
      return await this.decane.getUser(token);
    } catch (err) {
      if (err instanceof DecaneAuthError) {
        throw new UnauthorizedException(`Decane user verification failed: ${err.reason}`);
      }
      throw err;
    }
  }

  /**
   * Revokes the access token server-side (sign-out).
   */
  async revokeAccessToken(token: string): Promise<void> {
    try {
      await this.decane.revokeAccessToken(token);
    } catch (err) {
      this.logger.warn('Failed to revoke Decane access token', err);
    }
  }

  // ==========================================
  // Server-Side Sign-In Methods (Requires apiKey)
  // Used for testing, headless integrations, and machine flows
  // ==========================================

  /**
   * Trigger 6-digit OTP email to user.
   */
  async connectWithEmail(email: string): Promise<void> {
    try {
      await this.decane.connectWithEmail(email);
    } catch (err) {
      this.handleApiError(err);
    }
  }

  /**
   * Verify the 6-digit email OTP and return Decane session & token.
   */
  async verifyEmailCode(email: string, code: string): Promise<DecaneAuthResult> {
    try {
      return await this.decane.verifyEmailCode(email, code);
    } catch (err) {
      this.handleApiError(err);
    }
  }

  /**
   * Exchange an already-obtained Google ID token for a Decane session.
   */
  async connectWithGoogleToken(idToken: string): Promise<DecaneAuthResult> {
    try {
      return await this.decane.connectWithGoogleToken(idToken);
    } catch (err) {
      this.handleApiError(err);
    }
  }

  /**
   * Exchange a KingsChat OAuth access token for a Decane session.
   */
  async connectWithKingsChatToken(accessToken: string): Promise<DecaneAuthResult> {
    try {
      return await this.decane.connectWithKingsChatToken(accessToken);
    } catch (err) {
      this.handleApiError(err);
    }
  }

  /**
   * Custom auth: exchange a JWT from your own issuer.
   */
  async connectWithToken(token: string, opts?: { providerId?: string }): Promise<DecaneAuthResult> {
    try {
      return await this.decane.connectWithToken(token, opts);
    } catch (err) {
      this.handleApiError(err);
    }
  }

  /**
   * Get KingsChat OAuth configuration.
   */
  async getKingsChatConfig(): Promise<{ clientId: string; authorizationUrl: string }> {
    try {
      return await this.decane.getKingsChatConfig();
    } catch (err) {
      this.handleApiError(err);
    }
  }

  private handleApiError(err: unknown): never {
    if (err instanceof DecaneApiError) {
      this.logger.error(`Decane API Error [${err.code}] (Status: ${err.status})`);
      throw new BadRequestException(`Decane API error: ${err.code}`);
    }
    throw err;
  }
}
