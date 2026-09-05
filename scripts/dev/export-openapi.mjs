/**
 * Write the OpenAPI document to a file.
 *
 * Swagger is served at /api and /api-json, but ONLY in development or when
 * ENABLE_SWAGGER=true — so in staging and production there is no
 * machine-readable contract available anywhere, and anyone integrating against
 * a deployed environment has nothing to generate a client from.
 *
 * This exports it so the spec can be committed, published, or handed to a
 * partner without exposing the docs UI on a production host.
 *
 * Usage:
 *   pnpm start:dev
 *   pnpm docs:export            # -> docs/openapi.json
 *
 * Import that file, or the live /api-json URL, straight into Postman or
 * Insomnia. A checked-in Postman collection is deliberately NOT maintained
 * here: it would be a second copy of this contract, and it would go stale.
 */
import fs from 'node:fs';
import path from 'node:path';

const source = process.env.ARKRIDES_URL ?? 'http://localhost:4010';
const target = process.argv[2] ?? 'docs/openapi.json';

const res = await fetch(`${source}/api-json`);
if (!res.ok) {
  console.error(
    `Could not read ${source}/api-json (HTTP ${res.status}).\n` +
      'Is the app running, and is Swagger enabled? It is on automatically in\n' +
      'development; elsewhere it needs ENABLE_SWAGGER=true.',
  );
  process.exit(1);
}

const spec = await res.json();

const operations = Object.values(spec.paths).reduce(
  (total, item) =>
    total +
    Object.keys(item).filter((k) =>
      ['get', 'post', 'put', 'patch', 'delete'].includes(k),
    ).length,
  0,
);

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(spec, null, 2) + '\n');

console.log(
  `Wrote ${target} — ${operations} operations, ` +
    `${Object.keys(spec.components?.schemas ?? {}).length} schemas.`,
);
