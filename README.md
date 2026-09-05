# Ark Rides — Backend

Ride-hailing backend for Ark Rides: keke, okada, car and courier trips across
Lagos, booked in-app or through WhatsApp and voice.

NestJS 11 · PostgreSQL (TypeORM) · Redis · BullMQ · Socket.IO · Privy

---

## What it does

| Domain | What lives there |
|---|---|
| **Identity** | Rider and driver accounts, OTP verification, password reset, **Privy single sign-on** shared with the rest of WorldStreet, rotating refresh-token sessions |
| **Rides** | Fare estimation, request, dispatch, the accept → arrived → started → completed lifecycle, cancellation, ratings |
| **Ledger** | The signed, append-only audit trail every naira moves through. A unique partial index makes paying a fare split twice structurally impossible |
| **Wallet** | Driver balance, fuel-support advances, payouts. Redis lock + pessimistic row lock + reversal on gateway failure |
| **Emergency** | In-trip SOS: persisted, broadcast over websockets, and queued to external responders |
| **Booking channels** | WhatsApp and voice ingress — parse a natural-language message into a ride and book it through the same service the app uses |
| **Driver locations** | Redis GEO ring for "who is near me" |
| **Stats** | Operational and financial analytics, derived from the ledger |
| **Realtime** | Socket.IO gateway pushing ride state to both sides of a trip |

---

## Running it

```bash
pnpm install
cp .env.example .env          # then fill it in — see below
docker compose -f compose.local.yml up -d   # postgres + redis
pnpm migration:run            # build the schema
pnpm start:dev
```

Swagger is at `http://localhost:4010/api` in development.

### The two variables you cannot skip

**`NODE_ENV`** — one of `development | test | staging | production`. Required,
and value-checked, because it decides whether Swagger is exposed, whether CORS
falls back to allowing localhost, and whether the production-only checks run.
Every one of those used to fail *open* when it was unset, and `compose.yml` set
nothing. `compose.yml` now pins it to `production` unless you override it.

**`JWT_SECRET`**, at least 32 characters. The app **refuses to start** without it:

```bash
openssl rand -base64 48
```

There is no default and there must never be one. Four call sites used to fall
back to the literal string `'your-secret-key'`, which meant anyone who had read
this repository could mint an admin token against any deployment that had not
set the variable.

`.env.example` documents all 27 variables and what breaks without each.
`src/config/env.validation.ts` decides which are fatal in which environment.

---

## Database

Migrations are the only way the schema changes. `synchronize` is off by default
in every environment, including development.

```bash
pnpm migration:run            # local, via ts-node
pnpm migration:show           # what has and has not run
pnpm migration:revert         # undo the last one
pnpm migration:run:prod       # in a container, against compiled dist/
```

> **Why two run commands.** The production image runs `pnpm prune --prod`, which
> removes `ts-node` — so `typeorm-ts-node-commonjs` cannot start there.
> `migration:run:prod` uses the compiled `dist/data-source.js` and needs no
> TypeScript at all.

The baseline migration builds the whole schema from empty. It was generated
from the entities against a real Postgres rather than written by hand, and is
verified to produce a byte-identical schema on three paths: an empty database,
a database that `synchronize` already built, and a re-run.

```bash
docker run -d --name pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:16-alpine
pnpm schema:sync:dev arkrides_check      # build a reference from the entities
ts-node scripts/dev/verify-stats.ts      # run every stats query for real
```

---

## Authentication

Two ways in. Both end at the same place: an Ark Rides access token.

### Privy (WorldStreet single sign-on)

Ark Rides shares one Privy application with Market Square and the rest of
WorldStreet, so a rider who already has a WorldStreet identity signs in with it.

```http
POST /api/v1/auth/privy
Content-Type: application/json
privy-id-token: <Privy identity token>      # optional; carries the wallet

{ "accessToken": "<Privy access token>", "audience": "rider" }
```

Two Privy tokens, two jobs:

- the **access token** proves *who* the caller is — its `sub` is the Privy DID;
- the **identity token** carries their embedded wallet, and is **verified**,
  never trusted. This API is public: a plain header would let anyone claim any
  address and point a payout at a stranger.

`audience` is required and is not a guess. Privy issues one DID, while this
service has two identity tables with separate id spaces (`users` and `drivers`)
that every guard, the JWT payload and the websocket handshake are built on — and
one person may legitimately own an account in each. So the rider app asks for a
rider session and the driver app asks for a driver session.

Riders are provisioned on first sign-in. **Drivers are not**: driving requires a
licence, a vehicle and an admin approval, so an unknown DID asking for a driver
session is told to register.

Wallet addresses are recorded, not yet settled against — earnings still move
through the naira ledger. The address is what KASH payouts will use.

### Email and password

`POST /api/v1/auth/register` → `verify-otp` → `login`. Unchanged, and unaffected
by Privy being unconfigured.

### Sessions

Every sign-in path — password, OTP, driver, Privy — returns the same session:
an access token good for **one hour**, plus a refresh token good for 30 days.
Refresh tokens are stored only as SHA-256 hashes and **rotate on every use**.

```http
POST /api/v1/auth/refresh   { "refreshToken": "..." }
POST /api/v1/auth/logout    { "refreshToken": "..." }
```

If an already-consumed refresh token is presented, two parties hold it and there
is no way to tell which is the thief — so the **entire token family is revoked**
and both are signed out. The same applies to two refreshes arriving at once,
which is indistinguishable from theft; clients must serialise their refreshes.
The consume is a conditional `UPDATE ... WHERE revokedAt IS NULL`, so the
database decides the winner rather than a read-then-write in application code.

Suspending, rejecting or deleting a driver revokes their sessions immediately —
a flag alone would have left them working for up to thirty days. The account is
also re-read from the database on every refresh, and the caller's **role comes
from the row, never from the token**, so a demotion takes effect at once rather
than at the end of the hour.

---

## API shape

Every endpoint returns one of exactly two shapes.

```jsonc
// 2xx
{
  "success": true,
  "statusCode": 200,
  "message": "Request successful",
  "data": { },
  "meta": { "page": 1, "limit": 20, "total": 41, "totalPages": 3 },  // lists only
  "timestamp": "2026-09-05T09:12:33.000Z"
}

// 4xx / 5xx
{
  "success": false,
  "statusCode": 400,
  "message": "email: email must be an email",   // ALWAYS one string
  "code": "VALIDATION_FAILED",
  "errors": [ { "field": "email", "messages": ["email must be an email"] } ],
  "path": "/api/v1/auth/register",
  "timestamp": "2026-09-05T09:12:33.000Z",
  "requestId": "…"                              // 5xx only — quote it in a report
}
```

A 5xx never carries its internal message. That goes to the log against
`requestId`; the caller gets the id.

---

## Authorization

- `JwtAuthGuard` authenticates; `RolesGuard` checks `@Roles(...)`.
- Ownership is **not** left to individual handlers. `assertOwnership` and
  `assertPartyToRide` in `src/common/utils/ownership.util.ts` are the only
  implementations, and every route touching a row someone owns calls one.
- Admin is granted by direct SQL. There is no endpoint that mints an admin.
- `/api/v1/booking-channels/*` authenticates with `INTERNAL_API_KEY` and a
  constant-time compare. It fails **closed** when the key is unset.

Rate limiting is Redis-backed, so it holds across replicas. Three named
throttlers — `short` (burst), `medium` (per minute), `long` (per hour) — and
every credential endpoint tightens `short` and `medium` on top.

---

## Realtime

```js
io('https://api.arkrides.com/rides', { auth: { token: '<access token>' } })
```

The handshake is authenticated and resolved through the same
`AuthResolverService` HTTP uses, so the two can never disagree about who a token
belongs to. `join:ride` is authorised against the ride: a driver may join only a
ride assigned to them, a rider only their own.

Socket CORS and HTTP CORS both read `CORS_ORIGINS`. Socket.IO negotiates its own
policy and is *not* covered by `app.enableCors()` — they used to be configured
separately and both left open.

---

## Tests

```bash
pnpm test              # 364 unit tests
pnpm test:cov
pnpm lint
```

Three things are verified outside the unit suite, because a mocked repository
cannot tell you whether the SQL works and a guard unit test cannot tell you
whether the request ever reaches the guard:

```bash
pnpm verify:stats      # every stats aggregate against a real Postgres, seeded + empty
pnpm verify:exploits   # 32 real exploits replayed against a RUNNING server
pnpm migration:run     # verified on empty, synchronize-built, legacy and re-run paths
```

`scripts/dev/exploit-suite.mjs` is the important one. Every case in it is a
request that **used to succeed**: a driver approving their own licence, a rider
deleting a stranger's vehicle, booking a ride onto someone else's account,
reading another rider's history or a driver's live GPS and phone number. Unit
tests assert a guard returns false; this asserts the request comes back 403,
which is a different claim — and several of these bugs existed precisely
because the check sat somewhere the request never reached.

Privy verification is tested against the **real `@privy-io/node` verifier** with
tokens minted from a generated ES256 keypair (`src/auth/privy/test-tokens.ts`) —
a mock could not demonstrate that a forged token is rejected.

---

## Layout

```
src/
├── auth/           identity: local, OTP, Privy, sessions, guards, strategies
│   ├── privy/      Privy access + identity token verification
│   └── services/   token issue/rotate/revoke, JWT → principal resolution
├── rides/          lifecycle, fares, ratings
├── drivers/        driver accounts, verification, availability
├── vehicles/
├── driver-locations/  Redis GEO
├── ledger/         the money audit trail
├── wallet/         driver balance, fuel support, payouts
├── emergency/      SOS
├── booking-channels/  WhatsApp / voice ingress + NL parsing
├── stats/          analytics, derived from the ledger
├── websocket/      Socket.IO gateway (leaf: nothing imports it)
├── common/         filters, interceptors, guards, ownership, money, OTP
├── config/         env validation, JWT, CORS
└── migrations/
```

`booking-channels` books through `RidesService.createRide()` rather than writing
rides itself — one booking path, so an invariant added for the app applies to
WhatsApp automatically.

---

## Known gaps

Stated plainly, because they matter more than the feature list.

- **No payment collection.** `completeRide` credits the driver 95% and the rider
  1% cashback, but the rider is never charged and there is no
  `RIDER_FARE_DEBIT` ledger type. The ledger is single-entry today: money is
  created on completion.
- **Wallet providers are simulated.** `MFB_PROVIDER` and `LINKPAY_PROVIDER`
  accept only `simulated`, and the module refuses to boot otherwise. No real
  disbursement or payout integration exists yet.
- **Fuel support has no repayment path.** Advances are credited and capped
  daily; nothing deducts them from future earnings.
- **Payouts are never settled.** Nothing transitions a `PENDING` payout to
  `COMPLETED` — there is no provider callback endpoint.
- **Geocoding is six hardcoded landmarks** (`booking-channels/geocoding`), and
  the ride parser is a keyword table with two regexes. Both are placeholders
  and both say so in their own headers.
- **`driver_locations` is never written.** Live position lives in Redis GEO; the
  table exists and stays empty, and drivers are never removed from the geo set
  when they go offline.
- **No users controller.** There is no way for a rider to read or update their
  own profile, or to see their cashback balance, outside the login response.
