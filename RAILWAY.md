# Deploying the API to Railway

## Before you start

**This app refuses to boot if its environment is incomplete.** That is
deliberate — a half-configured API that starts and then 500s is worse than one
that tells you what is missing — but it means a deploy with gaps will
crash-loop with a readable list of problems in the logs rather than coming up
degraded. Read the variables table before the first deploy.

You need a SendGrid API key. There is no way around it in production: OTP
delivery for password reset goes through SendGrid, and the app will not start
without `SENDGRID_API_KEY` and `SENDGRID_FROM_EMAIL`.

## 1. Services

Create one Railway project with three services:

| Service | How |
|---|---|
| **Postgres** | New → Database → PostgreSQL |
| **Redis** | New → Database → Redis |
| **API** | New → GitHub Repo → `ogazboiz/arkride-backend` |

Railway reads `railway.json` and builds from the multi-stage `Dockerfile`.

## 2. Environment variables

Set these on the **API** service. Railway exposes the database services'
credentials as variable references — use those rather than pasting values, so
a rotated password does not silently break the API.

### Copy-paste block

Railway's Variables tab has a **Raw Editor**. Paste this in, then replace the
two placeholders and generate your own secrets — do not ship the ones below,
they are illustrative.

```env
NODE_ENV=production
JWT_SECRET=<openssl rand -base64 48>
INTERNAL_API_KEY=<openssl rand -base64 32>

DATABASE_HOST=${{Postgres.PGHOST}}
DATABASE_PORT=${{Postgres.PGPORT}}
DATABASE_USERNAME=${{Postgres.PGUSER}}
DATABASE_PASSWORD=${{Postgres.PGPASSWORD}}
DATABASE_NAME=${{Postgres.PGDATABASE}}
DATABASE_SSL=true

REDIS_HOST=${{Redis.REDISHOST}}
REDIS_PORT=${{Redis.REDISPORT}}
REDIS_PASSWORD=${{Redis.REDISPASSWORD}}

PRIVY_APP_ID=<your Privy app id>
PRIVY_VERIFICATION_KEY=<the public verification key, newlines escaped as \n>

APP_NAME=Ark Rides
KEKE_WEBSITE_URL=https://arkrides.com
REPORTING_TIMEZONE=Africa/Lagos
CORS_ORIGINS=<your web app's public URL>

SENDGRID_API_KEY=<required — the app will not boot without it>
SENDGRID_FROM_EMAIL=<a verified sender on your SendGrid account>
```

The `${{Postgres.*}}` and `${{Redis.*}}` forms are Railway variable references,
resolved at deploy time from the database services in the same project. Use
them rather than pasting values: a rotated password then flows through instead
of silently breaking the API.

**Setting `NODE_ENV=production` alone is not enough.** That switch is what
*turns on* the other requirements — `INTERNAL_API_KEY`, `REDIS_HOST` and both
SendGrid variables are only enforced outside development. A deploy with just
`NODE_ENV` changed will crash-loop with a list of what is missing.

### Required — the app will not start without these

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | 48+ random bytes: `openssl rand -base64 48` |
| `INTERNAL_API_KEY` | `openssl rand -base64 32` |
| `SENDGRID_API_KEY` | from SendGrid |
| `SENDGRID_FROM_EMAIL` | a verified sender on your SendGrid account |
| `DATABASE_HOST` | `${{Postgres.PGHOST}}` |
| `DATABASE_PORT` | `${{Postgres.PGPORT}}` |
| `DATABASE_USERNAME` | `${{Postgres.PGUSER}}` |
| `DATABASE_PASSWORD` | `${{Postgres.PGPASSWORD}}` |
| `DATABASE_NAME` | `${{Postgres.PGDATABASE}}` |
| `DATABASE_SSL` | `true` |
| `REDIS_HOST` | `${{Redis.REDISHOST}}` |
| `REDIS_PORT` | `${{Redis.REDISPORT}}` |
| `REDIS_PASSWORD` | `${{Redis.REDISPASSWORD}}` |

`NODE_ENV` must be exactly `production`. `prod` is not a valid value and the
app rejects it — a typo there would otherwise skip every production safety
check and serve Swagger publicly, silently.

### Required for Privy sign-in

| Variable | Value |
|---|---|
| `PRIVY_APP_ID` | your Privy app id |
| `PRIVY_VERIFICATION_KEY` | the app's **public** verification key from the Privy dashboard |

Escape any newlines in the key as literal `\n`; the app unescapes them. Without
these, Privy sign-in returns 503 and password sign-in is unaffected.

### Configuration

| Variable | Value |
|---|---|
| `CORS_ORIGINS` | your web app's public domain, comma-separated. **Fails closed** — an unlisted origin is refused, and localhost is only allowed when `NODE_ENV=development`. |
| `PORT` | leave unset; Railway injects it and the app reads `process.env.PORT`. |
| `REPORTING_TIMEZONE` | `Africa/Lagos` — analytics day boundaries, not the server's timezone. |
| `APP_NAME` | `Ark Rides` |
| `ENABLE_SWAGGER` | leave unset in production. Setting it serves the full API surface publicly. |

## 3. Migrations

`railway.json` runs migrations before the server starts:

```
npx typeorm -d dist/data-source.js migration:run && node dist/main
```

`npx typeorm` against the **compiled** data source is not incidental. The
production image has no pnpm and no ts-node — the builder stage prunes them —
so `pnpm run migration:run` and the ts-node variant both fail on start. Both
have been shipped here before.

Migrations are convergent: they have been verified against an empty database, a
`synchronize`-built one, and a legacy database with duplicate rows, all
producing an identical schema, and they are safe to re-run.

## 4. Networking

Generate a domain only if the API needs to be reachable publicly. If the web
app is the only client, it can reach the API on Railway's private network
(`http://<service>.railway.internal:4010`) and the API never has to be exposed
at all — which is the better default.

## After deploying

```bash
# Should return the public stats envelope
curl https://<your-api-domain>/api/v1/stats/public
```

Then create an admin — there is no admin sign-up, by design:

```bash
curl -X POST https://<your-api-domain>/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Ops Admin","email":"you@arkrides.com","phone":"08012345678",
       "password":"<a real password>","confirmPassword":"<the same>",
       "acceptTerms":true}'
```

then promote that row in the Railway Postgres console:

```sql
UPDATE users SET role = 'admin' WHERE email = 'you@arkrides.com';
```

## If it crash-loops on first deploy

Read the logs. The env validation prints every problem as a sentence saying
which variable is missing and why it matters. That output is the fastest path
to a fix — it is more specific than anything in this document.
