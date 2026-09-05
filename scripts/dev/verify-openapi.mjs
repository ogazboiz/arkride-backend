/**
 * Assert the OpenAPI document describes what the API actually returns.
 *
 * Documentation drifts silently: a handler changes shape, the decorator does
 * not, and the spec keeps promising something that has not been true for
 * months. Anyone generating a client from it then writes code that cannot
 * parse a response, and finds out in integration.
 *
 * This fetches the LIVE spec and the LIVE responses and compares them, so the
 * failure shows up here instead.
 *
 * The specific drift it was written for: every handler declares its inner
 * payload, while a global interceptor wraps all of them in an envelope — so
 * all 67 documented response shapes were wrong in the same way.
 *
 * Usage:
 *   pnpm start:dev
 *   pnpm verify:openapi
 */
const B = process.env.ARKRIDES_URL ?? 'http://localhost:4010';

const spec = await (await fetch(`${B}/api-json`)).json();

const required = (name) =>
  spec.components.schemas[name].required ?? [];

const successKeys = required('ApiSuccessEnvelope');
const failureKeys = required('ApiFailureEnvelope');

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'MATCH ' : 'DIFFER'}  ${label}${detail ? '  ' + detail : ''}`);
};

async function get(path, opts = {}) {
  const res = await fetch(B + path, opts);
  return { status: res.status, body: await res.json().catch(() => null) };
}

console.log('spec says a SUCCESS body has:', successKeys.join(', '));
const ok = await get('/api/v1/stats/public');
check('GET /stats/public 200 has every required success key',
  successKeys.every((k) => k in ok.body), `got: ${Object.keys(ok.body).join(',')}`);

console.log('\nspec says a FAILURE body has:', failureKeys.join(', '));
const unauth = await get('/api/v1/stats/revenue');
check('401 has every required failure key',
  failureKeys.every((k) => k in unauth.body), `got: ${Object.keys(unauth.body).join(',')}`);
check('401 code is in the documented enum',
  spec.components.schemas.ApiFailureEnvelope.properties.code.enum.includes(unauth.body.code),
  `code=${unauth.body.code}`);

const bad = await fetch(B + '/api/v1/auth/privy', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
});
const badBody = await bad.json();
check('400 carries the documented `errors` array', Array.isArray(badBody.errors));
check('400 `errors[]` matches ApiFieldError',
  badBody.errors.every((e) => 'field' in e && Array.isArray(e.messages)));
check('message is a single string, never an array', typeof badBody.message === 'string');

// 204 must carry NO body — the spec now says so explicitly.
const has204 = spec.paths['/api/v1/auth/logout'].post.responses['204'];
check('204 documented with no content', !has204.content);

console.log(`\n==> ${pass} match, ${fail} differ`);
process.exit(fail === 0 ? 0 : 1);
