# Ark Rides — Backend

Ride-hailing backend for Ark Rides: keke, okada, car and courier trips across
Lagos, booked in the app or through WhatsApp and voice.

**NestJS 11 · PostgreSQL (TypeORM) · Redis · BullMQ · Socket.IO · Privy**

```
Rider app ─┐                                    ┌─ PostgreSQL   rides, ledger, identities
Driver app ─┼─► REST /api/v1 ──► NestJS ────────┼─ Redis        locks, driver geo, rate limits, queues
WhatsApp ──┘    Socket.IO /rides                └─ Privy        identity verification (offline, by public key)
```

---

## Contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Environment](#environment)
- [Database and migrations](#database-and-migrations)
- [Authentication](#authentication)
- [The API contract](#the-api-contract)
- [Endpoints](#endpoints)
- [Authorization](#authorization)
- [Realtime](#realtime)
- [Domain model](#domain-model)
- [Testing and verification](#testing-and-verification)
- [Project layout](#project-layout)
- [Known gaps](#known-gaps)

---

## What it does

| Module | Responsibility |
|---|---|
| **auth** | Rider and driver accounts, OTP verification, password reset, **Privy single sign-on** shared with the rest of WorldStreet, rotating refresh-token sessions |
| **rides** | Fare estimation, request, dispatch, the accept → arrived → started → completed lifecycle, cancellation, ratings |
| **ledger** | The signed, append-only audit trail every naira passes through. A unique partial index makes paying one fare split twice structurally impossible |
| **wallet** | Driver balance, fuel-support advances, payouts. Redis lock + pessimistic row lock + reversal on gateway failure |
| **emergency** | In-trip SOS: persisted first, then broadcast over websockets, then queued to external responders |
| **booking-channels** | WhatsApp and voice ingress — parses a natural-language message into a ride and books it through the same service the app uses |
| **driver-locations** | Redis GEO ring answering "who is near me" |
| **stats** | Operational and financial analytics, derived from the ledger |
| **websocket** | Socket.IO gateway pushing ride state to both sides of a trip |

---

## Quick start

```bash
pnpm install
cp .env.example .env
```

Fill in the three generated values:

```bash
openssl rand -base64 48   # -> JWT_SECRET       (required, min 32 chars)
openssl rand -hex 32      # -> INTERNAL_API_KEY
openssl rand -hex 24      # -> REDIS_PASSWORD   (the local stack will not start without it)
```

Copy `PRIVY_APP_ID` and `PRIVY_VERIFICATION_KEY` from
`wsws-monorepo/apps/market-square/.env` — it is the same shared WorldStreet
Privy application, deliberately (see [Authentication](#authentication)).

```bash
docker compose -f compose.local.yml --env-file .env up -d postgres redis
pnpm migration:run
pnpm start:dev
```

Interactive API docs: **http://localhost:4010/api** · raw spec: `/api-json`

> **Port note.** `.env.example` puts Postgres on **5433** and Redis on **6380**,
> not the defaults. `compose.local.yml` publishes both from `${DATABASE_PORT}`
> and `${REDIS_PORT}`, so one variable moves the container and the app together.
> A Postgres already running on `127.0.0.1:5432` wins over Docker's binding for
> `localhost`, and the app then silently connects to *your* database and fails
> with `database "arkrides" does not exist` — which reads like a broken
> migration rather than a port clash.

---

## Environment

The app validates the environment **before** it constructs anything and refuses
to start when something required is missing, blank, or left as a placeholder
(`src/config/env.validation.ts`). If it starts, the environment is complete.

`.env.example` documents all 21 variables. The ones worth knowing:

| Variable | Required | Why it matters |
|---|---|---|
| `NODE_ENV` | **always** | Decides whether Swagger is exposed, whether CORS falls back to localhost, and whether the production-only checks run. Every one of those used to fail *open* when it was unset. Must be `development`, `test`, `staging` or `production` — `prod` is rejected, because a near-miss would silently disable the lot |
| `JWT_SECRET` | **always** | Signs every access token, min 32 chars. There is no default and there must never be one |
| `DATABASE_URL` *or* `DATABASE_HOST` | production | — |
| `REDIS_HOST`, `REDIS_PASSWORD` | production | Ride locking, driver geo, rate limiting, job queues |
| `PRIVY_APP_ID`, `PRIVY_VERIFICATION_KEY` | for Privy sign-in | Unset, `/auth/privy` returns **503** and email/password login is unaffected |
| `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` | production | **The only values nobody can generate for you.** Development boots without them and OTP/reset emails are dropped |
| `INTERNAL_API_KEY` | production | Shared secret for the WhatsApp/voice ingress. Fails **closed** when unset |
| `CORS_ORIGINS` | production | Covers **both** the REST API and the Socket.IO handshake |
| `EMERGENCY_WEBHOOK_URLS` | should | Unset, an SOS is recorded and broadcast in-app but **no external party is told** |
| `REPORTING_TIMEZONE` | no | Defaults `Africa/Lagos`. Analytics day boundaries — a UTC container would report Lagos's first hour of every morning as yesterday |

`.env.staging.example` and `.env.main.example` cover the deployed environments
and list only what differs. **Staging and production must use different
`JWT_SECRET`s** — sharing one makes a staging token a production token.

---

## Database and migrations

Migrations are the only way the schema changes. `synchronize` is **off by
default in every environment**, including development, and refuses to engage
outside development even if `DB_SYNCHRONIZE=true` is set.

```bash
pnpm migration:run           # local, via ts-node
pnpm migration:show          # what has and has not run
pnpm migration:revert        # undo the last one
pnpm migration:run:prod      # in a container, against compiled dist/
```

> **Why two run commands.** The production image runs `pnpm prune --prod`, which
> removes `ts-node` — so `typeorm-ts-node-commonjs` cannot start there, and
> `pnpm` is not on the image at all. The prod command is
> `npx typeorm -d dist/data-source.js migration:run` and needs no TypeScript.

The baseline migration builds the whole schema from empty. It was **generated
from the entities against a real Postgres and dumped**, not written by hand, and
it is verified to produce an identical schema on four paths: an empty database,
one that `synchronize` already built, a *legacy* one missing the newer columns
and carrying duplicate rows, and a re-run.

---

## Authentication

Two ways in. Both end at the same place: an Ark Rides session.

### Privy — WorldStreet single sign-on

Ark Rides shares **one Privy application** with Market Square and the rest of
WorldStreet, so a rider who already has a WorldStreet identity signs in with it.

```http
POST /api/v1/auth/privy
Content-Type: application/json
privy-id-token: <Privy identity token>        # optional; carries the wallet

{ "accessToken": "<Privy access token>", "audience": "rider" }
```

**Two Privy tokens, two jobs** — confusing them is the classic bug:

| Token | Carries | Used for |
|---|---|---|
| **access** (`Authorization: Bearer`) | `sub` = the Privy DID, and nothing else | proving *who* the caller is |
| **identity** (`privy-id-token` header) | linked accounts: wallet and email | reading the wallet and the verified email |

Both are verified offline against the app's public key, so an outage at Privy
does not take sign-in with it.

> **The identity token is verified, never trusted.** The wallet and the email
> used for account linking must never come from the request body: this API is
> public, so a body field would let anyone claim any address and be handed that
> account — plus have its payout wallet repointed. `email` is deliberately not a
> field on `PrivySignInDto`; do not reintroduce it.

**`audience` is required and is not a guess.** Privy issues one DID, while this
service has two identity tables with separate id spaces (`users` and `drivers`)
that every guard, the JWT payload and the websocket handshake are built on — and
one person may legitimately own an account in each. So the rider app asks for a
rider session and the driver app asks for a driver session.

Riders are provisioned on first sign-in. **Drivers are not**: driving requires a
licence, a vehicle and an admin approval, so an unknown DID asking for a driver
session is told to register.

Wallet addresses are **recorded, not yet settled against** — earnings still move
through the naira ledger. The address is what KASH payouts will use.

### Email and password

`POST /auth/register` → `verify-otp` → `login`. Unaffected by Privy being
unconfigured. OTPs are **six digits**, generated with `crypto.randomInt` and
compared in constant time.

### Sessions

Every sign-in path — password, OTP, driver, Privy — returns the same session:

```jsonc
{
  "accessToken": "…",   // 1 hour
  "refreshToken": "…",  // 30 days, single use
  "expiresIn": 3600,
  "tokenType": "Bearer",
  "token": "…"          // alias for accessToken, for older clients
}
```

```http
POST /api/v1/auth/refresh   { "refreshToken": "…" }
POST /api/v1/auth/logout    { "refreshToken": "…" }
```

Refresh tokens are stored **only as SHA-256 hashes** and **rotate on every use**,
so a token is valid exactly once.

- Present an **already-consumed** token and two parties hold it, with no way to
  tell which is the thief — so the **entire token family is revoked** and both
  are signed out.
- The same applies to two refreshes arriving **at once**, which is
  indistinguishable from theft. Clients must serialise their refreshes.
- The consume is a conditional `UPDATE … WHERE revokedAt IS NULL`, so the
  database decides the winner rather than a read-then-write in application code.
- Suspending, rejecting or deleting a driver **revokes their sessions
  immediately** — a flag alone would leave them working for up to thirty days.
- The caller's **role comes from the database row, never from the token**, so a
  demotion takes effect at once rather than at the end of the hour.

---

## The API contract

Every endpoint returns one of exactly two shapes. There are no exceptions.

```jsonc
// any 2xx with a body
{
  "success": true,
  "statusCode": 200,
  "message": "Request successful",
  "data": { },
  "meta": { "page": 1, "limit": 20, "total": 41, "totalPages": 3 },  // lists only
  "timestamp": "2026-09-05T09:12:33.000Z"
}

// any 4xx / 5xx
{
  "success": false,
  "statusCode": 400,
  "message": "email: email must be an email",      // ALWAYS a single string
  "code": "VALIDATION_FAILED",                     // branch on this, not the message
  "errors": [                                      // validation failures only
    { "field": "email", "messages": ["email must be an email"] }
  ],
  "path": "/api/v1/auth/register",
  "timestamp": "2026-09-05T09:12:33.000Z",
  "requestId": "…"                                 // 5xx only — quote it in a report
}
```

`204 No Content` carries no body at all.

A **5xx never carries its internal message.** That goes to the log against
`requestId`; the caller gets the id and nothing else.

`code` values: `VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`,
`CONFLICT`, `DUPLICATE_VALUE`, `INVALID_REFERENCE`, `MALFORMED_IDENTIFIER`,
`RATE_LIMITED`, `DATABASE_ERROR`, `INTERNAL_ERROR`.

Lists return `data: [...]` with the count in `meta.total` — never a
`{ count, rides }` wrapper.

### Rate limits

Redis-backed, so they hold across replicas. Three named throttlers apply to
every request: `short` (10/s), `medium` (120/min), `long` (2000/hr). Credential
endpoints tighten this to **5 per minute, 3 per second** per IP.

### Using the docs

`http://localhost:4010/api` is a live Swagger UI; **Authorize** once and the
token persists across reloads. `/api-json` is the raw OpenAPI 3 document.

Import that URL — or the committed `docs/openapi.json` — straight into Postman
or Insomnia. There is deliberately **no checked-in Postman collection**: it
would be a second copy of the same contract, and it would go stale.

```bash
pnpm docs:export        # refresh docs/openapi.json from a running server
pnpm verify:openapi     # assert the document still matches live responses
```

Swagger is served only in development, or when `ENABLE_SWAGGER=true` — so on a
deployed host `docs/openapi.json` is the contract, which is why it is committed.

The document describes the **envelope**, not just the inner payload. Every
handler declares its inner payload and a single post-processing pass
(`common/swagger/document-envelope.ts`) wraps them all and attaches the failure
shapes — so no operation can be missed, which a per-handler decorator could
not guarantee.

---

## Endpoints

67 operations. `Who` is the role required; *public* means no token.

### App

| Method | Path | Who | What |
|---|---|---|---|
| `GET` | `/` | public | Liveness probe |

### Auth

| Method | Path | Who | What |
|---|---|---|---|
| `POST` | `/auth/forgot-password` | public | Request password reset OTP |
| `POST` | `/auth/login` | public | Sign in with email and password |
| `POST` | `/auth/logout` | public | Revoke a session |
| `POST` | `/auth/privy` | public | Sign in with a Privy access token |
| `POST` | `/auth/refresh` | public | Exchange a refresh token for a new session |
| `POST` | `/auth/register` | public | Register a new user account |
| `POST` | `/auth/resend-otp` | public | Resend account verification OTP |
| `POST` | `/auth/reset-password` | public | Reset password using OTP |
| `POST` | `/auth/verify-otp` | public | Verify account with OTP |

### Booking Channels

| Method | Path | Who | What |
|---|---|---|---|
| `POST` | `/booking-channels/parse-and-book` | public | Book a ride from a natural language message (WhatsApp / voice) |

### Driver Locations

| Method | Path | Who | What |
|---|---|---|---|
| `POST` | `/driver-locations` | driver | Publish the calling driver's current GPS position |
| `GET` | `/driver-locations/driver/{driverId}` | user, driver, admin | Get location for a specific driver |
| `GET` | `/driver-locations/nearby` | user, driver, admin | Find nearby drivers by coordinates and radius |

### Drivers

| Method | Path | Who | What |
|---|---|---|---|
| `GET` | `/drivers` | admin | List all drivers (admin) |
| `POST` | `/drivers/forgot-password` | public | Send a password-reset OTP to a driver |
| `POST` | `/drivers/login` | public | Driver login |
| `POST` | `/drivers/register` | public | Register a new driver |
| `POST` | `/drivers/reset-password` | public | Reset a driver password using an OTP |
| `DELETE` | `/drivers/{id}` | admin | Delete a driver |
| `GET` | `/drivers/{id}` | driver, admin | Get a driver profile (own, or any for an admin) |
| `PATCH` | `/drivers/{id}` | driver, admin | Update a driver's own profile |
| `PATCH` | `/drivers/{id}/active-status` | admin | Suspend or reinstate a driver (admin) |
| `PATCH` | `/drivers/{id}/online-status` | driver | Go online or offline (own account only) |
| `PATCH` | `/drivers/{id}/verification-status` | admin | Approve or reject a driver's licence (admin) |

### Emergency

| Method | Path | Who | What |
|---|---|---|---|
| `GET` | `/emergency/incidents` | admin | List emergency incidents |
| `PATCH` | `/emergency/incidents/{id}/resolve` | admin | Close out an emergency incident |
| `GET` | `/emergency/ride/{rideId}` | user, driver, admin | Get incidents raised on a ride |
| `POST` | `/emergency/trigger` | user, driver | Raise an in-ride SOS |

### Ledger

| Method | Path | Who | What |
|---|---|---|---|
| `GET` | `/ledger/driver/{driverId}` | driver, admin | Get a driver's ledger statement |
| `GET` | `/ledger/me` | user, driver, admin | Get my own ledger statement |
| `GET` | `/ledger/ride/{rideId}` | admin | Get all ledger entries for a ride |
| `GET` | `/ledger/summary` | admin | Platform revenue summary |

### Ratings

| Method | Path | Who | What |
|---|---|---|---|
| `POST` | `/ratings` | user, driver | Submit a rating for a completed ride |
| `GET` | `/ratings/ride/{rideId}` | user, driver, admin | Get ratings for a ride you were part of |

### Rides

| Method | Path | Who | What |
|---|---|---|---|
| `GET` | `/rides` | admin | List every ride (admin) |
| `POST` | `/rides` | user | Request a new ride |
| `GET` | `/rides/available` | driver | List rides waiting for a driver, matched to the caller's vehicles |
| `GET` | `/rides/driver/{driverId}` | driver, admin | List a driver's own ride history |
| `POST` | `/rides/estimate` | any signed-in | Get ride price estimates |
| `GET` | `/rides/user/{userId}` | user, admin | List a rider's own ride history |
| `GET` | `/rides/{id}` | user, driver, admin | Get one ride (must be a party to it) |
| `PATCH` | `/rides/{id}/accept` | driver | Accept a requested ride |
| `PATCH` | `/rides/{id}/arrived` | driver | Mark arrival at the pickup point |
| `GET` | `/rides/{id}/breakdown` | user, driver, admin | Get the revenue split for a ride |
| `PATCH` | `/rides/{id}/cancel/driver` | driver | Cancel an accepted ride as the driver |
| `PATCH` | `/rides/{id}/cancel/user` | user | Cancel a ride as the rider |
| `PATCH` | `/rides/{id}/complete` | driver | Complete the trip and settle the fare |
| `PATCH` | `/rides/{id}/start` | driver | Start the trip |

### Stats

| Method | Path | Who | What |
|---|---|---|---|
| `GET` | `/stats/dashboard` | admin | Admin overview |
| `GET` | `/stats/drivers` | any signed-in | Supply: verification funnel, availability, earnings |
| `GET` | `/stats/public` | public | Public headline numbers for the marketing site |
| `GET` | `/stats/revenue` | any signed-in | Financial position, derived from the ledger rather than from rides |
| `GET` | `/stats/rides` | admin | Ride volume, mix, timing and demand hotspots |

### Vehicles

| Method | Path | Who | What |
|---|---|---|---|
| `GET` | `/vehicles` | admin | List all vehicles (admin) |
| `POST` | `/vehicles` | driver, admin | Create vehicle for a driver |
| `GET` | `/vehicles/driver/{driverId}` | driver, admin | List vehicles for a driver |
| `DELETE` | `/vehicles/{id}` | driver, admin | Delete a vehicle |
| `GET` | `/vehicles/{id}` | driver, admin | Get vehicle by ID |
| `PATCH` | `/vehicles/{id}` | driver, admin | Update vehicle details |
| `PATCH` | `/vehicles/{id}/activate` | driver, admin | Activate a vehicle |
| `PATCH` | `/vehicles/{id}/deactivate` | driver, admin | Deactivate a vehicle |

### Wallet

| Method | Path | Who | What |
|---|---|---|---|
| `GET` | `/wallet/balance` | driver | Get my wallet balance and fuel allowance |
| `GET` | `/wallet/fuel-support/limit` | driver | Get today's remaining MFB fuel support allowance |
| `POST` | `/wallet/fuel-support/request` | any signed-in | Request daily fuel support from the microfinance bank |
| `POST` | `/wallet/payout` | driver | Withdraw earnings through LinkPay |
| `GET` | `/wallet/transactions` | driver | My wallet transaction history |

---

## Authorization

- `JwtAuthGuard` authenticates; `RolesGuard` enforces `@Roles(...)`.
- Ownership is **not** left to individual handlers. `assertOwnership` and
  `assertPartyToRide` in `src/common/utils/ownership.util.ts` are the only
  implementations, and every route touching a row someone owns calls one. The
  rule is uniform: an admin may act on anything, anyone else only on rows they
  own.
- A ride has **two** owners, so `assertPartyToRide` exists separately.
- Admin is granted by direct SQL. **There is no endpoint that mints an admin.**
- `/booking-channels/*` authenticates with `INTERNAL_API_KEY` and a constant-time
  compare, and fails **closed** when the key is unset.
- Live driver position is visible to the driver, an admin, or a rider with an
  **active ride with that driver** — not to any signed-in account.

---

## Realtime

```js
io('https://api.arkrides.com/rides', { auth: { token: '<access token>' } })
```

The handshake is authenticated through the same `AuthResolverService` HTTP uses,
so the two can never disagree about who a token belongs to.

**Server → client**

| Event | Room | Payload |
|---|---|---|
| `ride:requested` | `available-rides:<category>` | the new ride, to every eligible online driver |
| `ride:accepted` | `ride:<id>` | ride + driver |
| `ride:taken` | `available-rides:<category>` | tells other drivers to drop it from their list |
| `ride:arrived` | `ride:<id>` | driver is at the pickup point |
| `ride:started` | `ride:<id>` | trip underway |
| `ride:completed` | `ride:<id>` | ride + the 95/4/1 split |
| `ride:cancelled` | `ride:<id>` | ride + who cancelled |
| `driver:location` | `ride:<id>` | `{ driverId, rideId, latitude, longitude, updatedAt }` |
| `sos:triggered` | `ride:<id>`, `ops:emergency` | incident + live location |
| `auth:error` | the socket | handshake rejected, then disconnected |

**Client → server**

| Event | Body | Notes |
|---|---|---|
| `join:ride` | `{ rideId }` | **Authorised**: a driver may join only a ride assigned to them, a rider only their own. `rideId` must be a UUID |
| `leave:ride` | `{ rideId }` | |

Socket CORS and HTTP CORS both read `CORS_ORIGINS`. Socket.IO negotiates its own
policy and is *not* covered by `app.enableCors()` — they used to be configured
separately and both left open.

---

## Domain model

### Ride lifecycle

```
requested ──accept──► accepted ──arrived──► arrived ──start──► in_progress ──complete──► completed
    │                     │                    │                    │
    └──── cancelled ◄─────┴────────────────────┘                    │
         (rider: before start · driver: after accepting)            └──► fare settles to the ledger
```

Only the assigned driver may advance a ride, and acceptance is guarded by a
Redis lock so two drivers cannot take the same ride.

### Fare

Estimates are **server-authoritative** — the client sends coordinates and a
category, never a price. Distance is great-circle between pickup and dropoff.

| Category | Base | Per km |
|---|---|---|
| Shared keke | ₦250 | ₦50 |
| Okada | ₦300 | ₦70 |
| Private keke | ₦500 | ₦100 |
| Car | ₦1000 | ₦200 |

`POST /rides/estimate` returns all four so the rider picks.

### The 95/4/1 split

On completion the fare splits, in one transaction, in **kobo integers** (never
floats):

| Share | Goes to | Ledger type |
|---|---|---|
| 95% | driver's wallet balance | `ride_fare_driver` |
| 4% | platform revenue | `ride_fare_platform` |
| 1% | rider cashback | `ride_fare_rider_cashback` |

`ledger_entries` is the **source of truth**; `Driver.walletBalance` and
`User.cashbackBalance` are fast-read caches of it. `amount` is signed *relative
to that stakeholder*: positive means their balance rises, negative means it
falls. Platform revenue has no balance column at all — it is
`SUM(amount) WHERE stakeholderType = 'platform'`, so there is nothing to drift.

A unique partial index on `(rideId, type)` makes a second payout for the same
ride **impossible at the database level**, whatever the application does.

### Wallet

`fuel-support/request` credits an advance against a daily cap;
`payout` withdraws to a bank. Both take a Redis lock, then a pessimistic row
lock, write the ledger entry inside the transaction, call the gateway *after*
committing, and **reverse the balance** if the gateway declines.

---

## Testing and verification

```bash
pnpm test              # unit tests
pnpm test:e2e          # integration, needs postgres + redis running
pnpm test:cov
pnpm lint
```

> **Writing an integration test?** `Test.createTestingModule({ imports: [AppModule] })`
> builds the app *without* `main.ts`, so it has no validation pipe, no exception
> filter and no response envelope. Call `configureApp(app)` from
> `src/app-setup.ts` — that is the shared definition of what a request passes
> through, and it exists because the previous e2e test asserted a bare string
> and passed while the server returned it wrapped.

Three things are verified outside the unit suite, because a mocked repository
cannot tell you whether the SQL works and a guard unit test cannot tell you
whether the request ever reaches the guard:

```bash
pnpm verify:stats      # every stats aggregate against a real Postgres, seeded + empty
pnpm verify:openapi    # the OpenAPI document still matches live responses
pnpm verify:exploits   # every known exploit replayed against a RUNNING server
```

`scripts/dev/exploit-suite.mjs` is the important one. Every case in it is a
request that **used to succeed**: a driver approving their own licence, a rider
deleting a stranger's vehicle, booking a ride onto someone else's account,
reading another rider's history or a driver's live GPS and phone number. Unit
tests assert a guard returns false; this asserts the request comes back 403 —
a different claim, and several of those bugs existed precisely because the check
sat somewhere the request never reached.

Privy verification is tested against the **real `@privy-io/node` verifier** with
tokens minted from a generated ES256 keypair (`src/auth/privy/test-tokens.ts`) —
a mock could not demonstrate that a forged token is rejected.

CI runs the suite, the typecheck, and a migration build from empty on every push.

---

## Project layout

```
src/
├── auth/            identity: local, OTP, Privy, sessions, guards, strategies
│   ├── privy/       Privy access + identity token verification
│   └── services/    session issue/rotate/revoke, JWT → principal resolution
├── rides/           lifecycle, fares, ratings
├── drivers/         driver accounts, verification, availability
├── vehicles/
├── driver-locations/    Redis GEO
├── ledger/          the money audit trail
├── wallet/          driver balance, fuel support, payouts
├── emergency/       SOS
├── booking-channels/    WhatsApp / voice ingress + NL parsing
├── stats/           analytics, derived from the ledger
├── websocket/       Socket.IO gateway (a leaf: nothing imports it)
├── common/          filters, interceptors, ownership, money, OTP, swagger
├── config/          env validation, JWT, CORS, environment
└── migrations/
scripts/dev/         verification scripts (stats, openapi, exploits, schema sync)
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
  disbursement or payout integration exists.
- **Fuel support has no repayment path.** Advances are credited and capped
  daily; nothing deducts them from future earnings.
- **Payouts are never settled.** Nothing transitions a `PENDING` payout to
  `COMPLETED` — there is no provider callback endpoint.
- **Geocoding is six hardcoded landmarks** (`booking-channels/geocoding`), and
  the ride parser is a keyword table with two regexes. Both are placeholders and
  say so in their own headers.
- **`driver_locations` is never written.** Live position lives in Redis GEO; the
  table exists and stays empty, and drivers are never removed from the geo set
  when they go offline.
- **No users controller.** A rider cannot read or update their own profile, or
  see their cashback balance, outside the sign-in response.
- **OTP attempts are not counted.** `OtpUtil.MAX_ATTEMPTS` is defined but not
  enforced — the throttler is what bounds guessing today, and it is per IP
  rather than per account.
- **Substantial pre-existing lint debt** in the older modules. `pnpm lint`
  reports it; CI does not fail on it yet.
