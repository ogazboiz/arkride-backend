import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { isDevelopment } from './environment';

/**
 * CORS policy.
 *
 * `app.enableCors()` with no argument reflects every origin. Combined with the
 * websocket gateway's `origin: true, credentials: true`, this API had two
 * independently wide-open cross-origin policies in production.
 *
 * Now: an explicit allowlist from CORS_ORIGINS. Local development keeps a
 * permissive default so a laptop still works, because the alternative is that
 * somebody "fixes" their dev setup by putting `*` back into production.
 */

/** Origins always allowed while developing locally. */
const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
];

/** Parse the comma-separated allowlist. Blank entries and stray spaces ignored. */
export function parseOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Exported separately from `corsOptions` so the unit test can assert the
 * decision without constructing a Nest app.
 *
 * Note `origin === undefined`: that is a same-origin or non-browser caller
 * (curl, a mobile app, a server-to-server call). Those carry no Origin header
 * and are not subject to the same-origin policy, so refusing them would break
 * every native client while protecting nobody.
 */
export function isOriginAllowed(
  origin: string | undefined,
  allowlist: string[],
  isDev: boolean,
): boolean {
  if (origin === undefined) return true;
  if (allowlist.includes(origin)) return true;
  if (isDev && DEV_ORIGINS.includes(origin)) return true;
  return false;
}

export function corsOptions(env: NodeJS.ProcessEnv = process.env): CorsOptions {
  // Fails closed — an unset NODE_ENV does not allowlist localhost.
  const isDev = isDevelopment(env);
  const allowlist = parseOrigins(env.CORS_ORIGINS);

  return {
    origin(origin, callback) {
      if (isOriginAllowed(origin ?? undefined, allowlist, isDev)) {
        callback(null, true);
        return;
      }
      // Deny by not reflecting the origin, rather than by erroring: an error
      // here surfaces to the client as an opaque 500 instead of the CORS
      // failure the browser console should be showing.
      callback(null, false);
    },
    // NOT `credentials: true`.
    //
    // This API authenticates with `Authorization: Bearer`, never with cookies,
    // so credentialed cross-origin requests buy nothing — while making the
    // `origin === undefined` allowance above look load-bearing when it is not,
    // and widening the blast radius of any future allowlist mistake.
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-internal-api-key',
      'privy-id-token',
    ],
    maxAge: 86400,
  };
}
