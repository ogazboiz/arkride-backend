import {
  generateKeyPairSync,
  createSign,
  KeyObject,
} from 'node:crypto';

/**
 * A minimal ES256 JWT minter for tests.
 *
 * Why not `jose`? It is ESM-only, and this suite runs under ts-jest in CJS. But
 * the better reason is that hand-rolling the JWS here pins the exact wire
 * format Privy's verifier requires — base64url segments and a RAW r||s
 * signature — rather than trusting a second library to agree with the first.
 * If @privy-io/node ever changes what it accepts, this test fails rather than
 * quietly passing against a mock.
 *
 * Test-only: never imported by application code.
 */

export interface PrivyKeyPair {
  privateKey: KeyObject;
  /** SPKI PEM, the form the PRIVY_VERIFICATION_KEY env var holds. */
  publicKeyPem: string;
}

/** A fresh P-256 keypair. */
export function generatePrivyKeyPair(): PrivyKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  return {
    privateKey,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export interface MintOptions {
  privateKey: KeyObject;
  subject?: string;
  audience?: string;
  issuer?: string;
  /** Seconds from now. Negative mints an already-expired token. */
  expiresInSeconds?: number;
  /** Extra claims, merged last so a test can delete `sid` by passing undefined. */
  claims?: Record<string, unknown>;
  /** Header `typ`. Privy requires 'JWT'; a test can break it deliberately. */
  typ?: string | undefined;
}

/**
 * Sign a Privy-shaped access or identity token.
 *
 * `dsaEncoding: 'ieee-p1363'` is the load-bearing detail: Node signs ECDSA as
 * DER by default, and JWS requires the raw 64-byte r||s concatenation. A DER
 * signature here would be rejected by every verifier and look like a key
 * problem.
 */
export function mintPrivyToken(options: MintOptions): string {
  const {
    privateKey,
    subject = 'did:privy:test-user',
    audience = 'test-app-id',
    issuer = 'privy.io',
    expiresInSeconds = 3600,
    claims = {},
    typ = 'JWT',
  } = options;

  const now = Math.floor(Date.now() / 1000);

  const header: Record<string, unknown> = { alg: 'ES256' };
  if (typ !== undefined) header.typ = typ;

  const payload: Record<string, unknown> = {
    sid: 'test-session',
    iss: issuer,
    aud: audience,
    sub: subject,
    iat: now,
    exp: now + expiresInSeconds,
    ...claims,
  };

  // An explicit `undefined` in `claims` means "omit this claim" — that is how
  // the no-sid case is expressed.
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) delete payload[key];
  }

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(payload),
  )}`;

  const signature = createSign('SHA256')
    .update(signingInput)
    .sign({ key: privateKey, dsaEncoding: 'ieee-p1363' });

  return `${signingInput}.${base64url(signature)}`;
}
