import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { KeyObject } from 'node:crypto';
import { generatePrivyKeyPair, mintPrivyToken } from './test-tokens';
import { PrivyService, walletFromLinkedAccounts } from './privy.service';

/**
 * These tests mint REAL ES256 tokens against a keypair generated here and
 * verify them through the real @privy-io/node verifier. Nothing about Privy is
 * mocked, so the test pins the actual contract: algorithm, issuer, audience,
 * expiry and the required `sid` claim. A mocked verifier would have passed
 * happily while the wiring was wrong.
 */

const APP_ID = 'test-app-id';
const DID = 'did:privy:cmtest0000000000000000';

let privateKey: KeyObject;
let publicKeyPem: string;

beforeAll(() => {
  const pair = generatePrivyKeyPair();
  privateKey = pair.privateKey;
  publicKeyPem = pair.publicKeyPem;
});

interface TokenOverrides {
  sub?: string;
  aud?: string;
  iss?: string;
  expiresInSeconds?: number;
  claims?: Record<string, unknown>;
  key?: KeyObject;
}

function mintToken(over: TokenOverrides = {}): string {
  return mintPrivyToken({
    privateKey: over.key ?? privateKey,
    subject: over.sub ?? DID,
    audience: over.aud ?? APP_ID,
    issuer: over.iss ?? 'privy.io',
    expiresInSeconds: over.expiresInSeconds ?? 3600,
    claims: over.claims,
  });
}

async function buildService(
  env: Record<string, string | undefined>,
): Promise<PrivyService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      PrivyService,
      {
        provide: ConfigService,
        useValue: { get: (key: string) => env[key] },
      },
    ],
  }).compile();
  return moduleRef.get(PrivyService);
}

function configured(): Promise<PrivyService> {
  return buildService({
    PRIVY_APP_ID: APP_ID,
    PRIVY_VERIFICATION_KEY: publicKeyPem,
  });
}

describe('PrivyService', () => {
  describe('configuration', () => {
    it('reports unconfigured when both variables are missing', async () => {
      const service = await buildService({});
      expect(service.isConfigured).toBe(false);
    });

    it('reports unconfigured when only the app id is set', async () => {
      const service = await buildService({ PRIVY_APP_ID: APP_ID });
      expect(service.isConfigured).toBe(false);
    });

    it('reports configured when both are set', async () => {
      expect((await configured()).isConfigured).toBe(true);
    });

    it('treats a blank value as unset', async () => {
      const service = await buildService({
        PRIVY_APP_ID: '   ',
        PRIVY_VERIFICATION_KEY: publicKeyPem,
      });
      expect(service.isConfigured).toBe(false);
    });

    it('accepts a PEM written with literal \\n, as env files store it', async () => {
      // This is how the key is stored in .env across the WorldStreet repos.
      // Without the unescape, jose fails to parse it and EVERY sign-in breaks
      // with an error that looks like a bad token rather than a bad config.
      const escaped = publicKeyPem.replace(/\n/g, '\\n');
      const service = await buildService({
        PRIVY_APP_ID: APP_ID,
        PRIVY_VERIFICATION_KEY: escaped,
      });
      expect(await service.verifyAccessToken(mintToken())).toBe(DID);
    });
  });

  describe('verifyAccessToken', () => {
    it('returns the DID for a valid token', async () => {
      expect(await (await configured()).verifyAccessToken(mintToken())).toBe(DID);
    });

    it('refuses everything when Privy is not configured', async () => {
      const service = await buildService({});
      expect(await service.verifyAccessToken(mintToken())).toBeNull();
    });

    it('rejects a token signed by a different key', async () => {
      // The forgery case: correct claims, attacker's key.
      const attacker = generatePrivyKeyPair();
      const forged = mintToken({ key: attacker.privateKey });
      expect(await (await configured()).verifyAccessToken(forged)).toBeNull();
    });

    it('rejects a token minted for a different Privy app', async () => {
      const other = mintToken({ aud: 'someone-elses-app' });
      expect(await (await configured()).verifyAccessToken(other)).toBeNull();
    });

    it('rejects a token from a different issuer', async () => {
      expect(
        await (await configured()).verifyAccessToken(mintToken({ iss: 'evil.io' })),
      ).toBeNull();
    });

    it('rejects an expired token', async () => {
      expect(
        await (await configured()).verifyAccessToken(mintToken({ expiresInSeconds: -3600 })),
      ).toBeNull();
    });

    it('rejects a token with no session id', async () => {
      expect(
        await (await configured()).verifyAccessToken(
          mintToken({ claims: { sid: undefined } }),
        ),
      ).toBeNull();
    });

    it.each(['', 'garbage', 'a.b.c', 'Bearer something'])(
      'rejects the malformed token %p without throwing',
      async (token) => {
        expect(await (await configured()).verifyAccessToken(token)).toBeNull();
      },
    );

    it('never throws, whatever it is handed', async () => {
      const service = await configured();
      await expect(
        service.verifyAccessToken(null as unknown as string),
      ).resolves.toBeNull();
    });
  });

  describe('walletFromIdentityToken', () => {
    const embedded = {
      type: 'wallet',
      chain_type: 'ethereum',
      wallet_client_type: 'privy',
      address: '0xAbCdEf0123456789AbCdEf0123456789AbCdEf01',
    };

    /**
     * NOTE: `linked_accounts` is a JSON STRING inside the identity token, not
     * an array — @privy-io/node's parser throws outright on anything else
     * (`typeof linkedAccountsClaim !== 'string'`). Minting it as an array here
     * made every wallet read return null, which is precisely the mistake a
     * mocked verifier would have hidden. Real tokens are shaped this way, so
     * the tests are too.
     */
    function mintIdentityToken(accounts: unknown[]): string {
      return mintToken({
        claims: { linked_accounts: JSON.stringify(accounts), cr: '1700000000' },
      });
    }

    it('returns the embedded wallet, lower-cased', async () => {
      const token = mintIdentityToken([embedded]);
      expect(await (await configured()).walletFromIdentityToken(token)).toBe(
        '0xabcdef0123456789abcdef0123456789abcdef01',
      );
    });

    it('returns null when the user has no wallet linked', async () => {
      const token = mintIdentityToken([
        { type: 'email', address: 'rider@example.com' },
      ]);
      expect(await (await configured()).walletFromIdentityToken(token)).toBeNull();
    });

    it('prefers the embedded wallet over an externally linked one', async () => {
      // The parser drops `wallet_client_type` for non-Privy wallets, so this
      // also pins that our selection still works on the PARSED shape rather
      // than the raw claim shape.
      const token = mintIdentityToken([
        {
          type: 'wallet',
          chain_type: 'ethereum',
          wallet_client_type: 'metamask',
          address: '0x2222222222222222222222222222222222222222',
        },
        embedded,
      ]);
      expect(await (await configured()).walletFromIdentityToken(token)).toBe(
        embedded.address.toLowerCase(),
      );
    });

    it('returns null rather than throwing on a malformed linked_accounts claim', async () => {
      const token = mintToken({ claims: { linked_accounts: 'not json' } });
      expect(await (await configured()).walletFromIdentityToken(token)).toBeNull();
    });

    it('returns null for an absent token rather than throwing', async () => {
      const service = await configured();
      expect(await service.walletFromIdentityToken(null)).toBeNull();
      expect(await service.walletFromIdentityToken(undefined)).toBeNull();
    });

    it('returns null for a forged identity token', async () => {
      // The whole reason the wallet is read from a VERIFIED token instead of a
      // plain header: otherwise anyone could claim any address and a payout
      // would go to a stranger.
      const attacker = generatePrivyKeyPair();
      const forged = mintToken({
        key: attacker.privateKey,
        claims: { linked_accounts: JSON.stringify([embedded]), cr: '1700000000' },
      });
      expect(await (await configured()).walletFromIdentityToken(forged)).toBeNull();
    });
  });

  describe('walletFromLinkedAccounts', () => {
    const embedded = {
      type: 'wallet',
      chain_type: 'ethereum',
      wallet_client_type: 'privy',
      address: '0x1111111111111111111111111111111111111111',
    };
    const external = {
      type: 'wallet',
      chain_type: 'ethereum',
      wallet_client_type: 'metamask',
      address: '0x2222222222222222222222222222222222222222',
    };

    it('prefers the embedded wallet over a linked one', () => {
      expect(walletFromLinkedAccounts([external, embedded])).toBe(embedded.address);
    });

    it('falls back to an external wallet when there is no embedded one', () => {
      // A rider who linked only MetaMask still needs somewhere for money.
      expect(walletFromLinkedAccounts([external])).toBe(external.address);
    });

    it('parses linked_accounts delivered as a JSON string', () => {
      // Privy really does return this as a string sometimes.
      expect(walletFromLinkedAccounts(JSON.stringify([embedded]))).toBe(
        embedded.address,
      );
    });

    it('accepts the React SDK camelCase spelling', () => {
      expect(
        walletFromLinkedAccounts([
          {
            type: 'wallet',
            chainType: 'ethereum',
            walletClientType: 'privy',
            address: embedded.address,
          },
        ]),
      ).toBe(embedded.address);
    });

    it('ignores Solana wallets', () => {
      expect(
        walletFromLinkedAccounts([
          { type: 'wallet', chain_type: 'solana', address: 'So1111111111' },
        ]),
      ).toBeNull();
    });

    it('ignores non-wallet linked accounts', () => {
      expect(
        walletFromLinkedAccounts([
          { type: 'email', address: 'rider@example.com' },
          { type: 'phone', address: '+2348012345678' },
        ]),
      ).toBeNull();
    });

    it('rejects an address that is not a valid EVM address', () => {
      expect(
        walletFromLinkedAccounts([
          { type: 'wallet', chain_type: 'ethereum', address: '0xnope' },
        ]),
      ).toBeNull();
    });

    it.each([null, undefined, 42, {}, 'not json', '[', []])(
      'returns null for %p',
      (input) => {
        expect(walletFromLinkedAccounts(input)).toBeNull();
      },
    );
  });
});
