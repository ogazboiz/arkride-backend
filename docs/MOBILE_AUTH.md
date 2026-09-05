# Auth integration guide (mobile)

Base URL (production): `https://arkride-backend-production.up.railway.app`
Every route is prefixed `/api/v1`.

---

## Read this first: there is no OTP step

**If your app is waiting for an OTP after registration, it will wait forever.**

`POST /auth/register` marks the account verified immediately and returns a
usable session in the same response. It stores `otpCode: null`, so the
verification endpoints have nothing to check against and always fail:

```
POST /auth/verify-otp  ->  400  "Account is already verified"
POST /auth/resend-otp  ->  400  "Account is already verified"
```

That is not a bug you can work around by sending a different code — those two
endpoints cannot succeed for an account created via `/auth/register`.

**What to do:** delete the OTP screen from the sign-up flow. Registration
returns `accessToken` and `refreshToken`; store them and go straight to the
signed-in state.

There is also **no email provider configured in production right now**, so
nothing would be delivered even if the flow were live. That affects password
reset too — see [Password reset](#password-reset).

---

## Response shape

Every response — success or failure — uses one of two envelopes.

**Success (2xx):**

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Created successfully",
  "data": { },
  "timestamp": "2026-09-05T14:00:00.000Z"
}
```

**Failure (4xx/5xx):**

```json
{
  "success": false,
  "statusCode": 400,
  "message": "email: email must be an email",
  "code": "VALIDATION_FAILED",
  "errors": [{ "field": "email", "messages": ["email must be an email"] }],
  "path": "/api/v1/auth/login",
  "timestamp": "2026-09-05T14:00:00.000Z"
}
```

- `message` is **always a single string**, never an array.
- `errors` appears **only** on validation failures. Branch on its presence, not
  on the status code.
- **Branch on `code`, never on `message`.** Messages are written for humans and
  will change.

| `code` | Meaning |
|---|---|
| `VALIDATION_FAILED` | A field is wrong; read `errors` |
| `UNAUTHENTICATED` | Missing/expired/invalid token |
| `FORBIDDEN` | Signed in, but not allowed |
| `NOT_FOUND` | |
| `CONFLICT` / `DUPLICATE_VALUE` | Email, phone or plate already taken |
| `RATE_LIMITED` | Back off — see [Rate limits](#rate-limits) |
| `DRIVER_NOT_REGISTERED` | Privy identity has no driver account — start driver sign-up |
| `INTERNAL_ERROR` | Our fault. Quote `requestId` when reporting |

`204` responses (logout) have **no body at all** — do not try to parse them.

---

## Rider sign-up

```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "name": "Ada Okoro",
  "email": "ada@example.com",
  "phone": "08012345678",
  "password": "somethingLong",
  "confirmPassword": "somethingLong",
  "acceptTerms": true
}
```

**`phone` must be BARE DIGITS, 10–15 of them.** `^[0-9]{10,15}$` — no `+`, no
spaces, no dashes. Strip formatting before sending. (Driver sign-up uses a
*different* rule; see below. This catches people out.)

Send **exactly** these fields. The API rejects unknown keys with a 400 rather
than ignoring them.

**201 response `data`:**

```json
{
  "message": "Registration successful. You can now login.",
  "user": { "id": "...", "name": "...", "email": "...", "isVerified": true, "role": "user" },
  "accessToken": "eyJ...",
  "refreshToken": "...",
  "expiresIn": 3600,
  "tokenType": "Bearer",
  "token": "eyJ..."
}
```

`token` is a duplicate of `accessToken`, kept for older clients. Use
`accessToken`.

**Go straight to the signed-in state.** No verification step.

---

## Rider sign-in

```http
POST /api/v1/auth/login
{ "email": "ada@example.com", "password": "somethingLong" }
```

Same `data` shape as register.

Failures worth handling by message:

- `401 "Invalid credentials"` — wrong email or password. Do **not** tell the
  user which; the API deliberately does not distinguish them.
- `400 "This account uses Google Sign-In. Please log in with Google."`

---

## Driver sign-up (password)

```http
POST /api/v1/drivers/register
{
  "name": "Emeka Obi",
  "phone": "08012345678",
  "email": "emeka@example.com",
  "password": "atLeast8Chars",
  "licenseNumber": "AKW12345",
  "licenseExpiry": "2030-01-01",
  "vehicleType": "keke",
  "plateNumber": "LSD123AB",
  "vehicleColor": "Yellow",
  "vehicleModel": "Bajaj RE",
  "vehicleYear": 2019
}
```

Watch these three:

1. **`phone` uses a different rule from rider sign-up:**
   `^(\+234|0)[789]\d{9}$` — must start `+234` or `0`, then 7/8/9, then 9
   digits. `08012345678` is valid. Bare digits without the leading `0` are not.
2. **`vehicleType` must be one of** `keke`, `bike`, `car`, `courier`.
   **"okada" is not valid** — motorcycles are `bike`.
3. **`vehicleYear` is a NUMBER here** (`2019`, not `"2019"`). Implicit
   conversion is off, so a string is a 400. Note the Privy driver route wants a
   **string** for the same field — see below.

`password` needs at least 8 characters.

**201 response `data`:** `{ driver, accessToken, refreshToken, expiresIn, tokenType }`
— note the key is `driver`, not `user`, and there is no `token` alias.

The driver starts as `verificationStatus: "pending"` and **cannot go online
until an admin approves them.**

---

## Driver sign-in (password)

```http
POST /api/v1/drivers/login
{ "email": "emeka@example.com", "password": "atLeast8Chars" }
```

Returns `{ driver, accessToken, refreshToken, expiresIn, tokenType }`.

- `401 "This account signs in with Privy. Use Privy sign-in instead of a password."`
- `401 "Your account has been deactivated"`

---

## Privy sign-in

Get the tokens from the Privy SDK, then exchange them here.

```http
POST /api/v1/auth/privy
{
  "accessToken": "<Privy getAccessToken()>",
  "identityToken": "<Privy identity token>",
  "audience": "rider",
  "name": "Ada Okoro"
}
```

- `audience` is **required**: `"rider"` or `"driver"`. Privy issues one identity,
  but riders and drivers are separate accounts here, so you must say which.
- `identityToken` is optional but **send it** — it carries the verified email
  and wallet. Can also go in a `privy-id-token` header.
- `name` is only used when provisioning a brand-new rider.
- **There is deliberately no `email` field.** Sending one is a 400. The email
  comes only from the signed identity token — accepting a client-supplied
  address was an account-takeover vector.

**200 `data`** — note the key is `profile`, not `user`, and there is no `token`:

```json
{
  "accessToken": "...", "refreshToken": "...", "expiresIn": 3600,
  "tokenType": "Bearer",
  "isNewAccount": true,
  "profile": { "id": "...", "name": "...", "email": "...", "role": "user",
               "privyDid": "did:privy:...", "walletAddressEvm": "0x..." }
}
```

**Riders are created automatically** on first Privy sign-in. Drivers are not —
see next.

---

## Privy driver sign-up

A driver signing in with Privy for the first time gets:

```
400  code: "DRIVER_NOT_REGISTERED"
```

**This is not an error to show the user.** Catch that `code` and open your
licence + vehicle form, then:

```http
POST /api/v1/auth/privy/driver-register
{
  "accessToken": "<Privy getAccessToken()>",
  "identityToken": "<Privy identity token>",
  "name": "Emeka Obi",
  "phone": "08012345678",
  "licenseNumber": "AKW12345",
  "licenseExpiry": "2030-01-01",
  "vehicleType": "keke",
  "plateNumber": "LSD123AB",
  "vehicleColor": "Yellow",
  "vehicleModel": "Bajaj RE",
  "vehicleYear": "2019"
}
```

**`vehicleYear` is a STRING on this route** (`"2019"`), unlike
`/drivers/register` which wants a number. That is an inconsistency in the API,
not a typo in this document — send a string here.

No `email` and no `password`: both come from the signed Privy token.

Returns a driver session. **Drivers created this way are auto-approved and can
go online immediately** — they do not appear in the admin review queue. That is
current demo behaviour and is expected to change, so do not build UI that
depends on it.

Signing in again with the same identity just signs them in; it does not create
a second account.

---

## Using the token

```http
Authorization: Bearer <accessToken>
```

Bearer header only. **There is no cookie support** — do not send
`credentials: 'include'`, it will not work.

---

## Refreshing the session

Access tokens last **1 hour** (`expiresIn: 3600`). Refresh tokens last 30 days.

```http
POST /api/v1/auth/refresh
{ "refreshToken": "<stored refresh token>" }
```

Returns a new `{ accessToken, refreshToken, expiresIn, tokenType }`.

**Three rules you must follow or users get signed out unexpectedly:**

1. **The old refresh token is consumed.** Always store the new one.
2. **Never refresh twice at once.** Presenting an already-spent token is
   treated as theft and **revokes the entire token family** — signing that user
   out of every device. If several requests 401 together, queue them behind
   *one* refresh; do not fire one per request.
3. Any failure returns the same `401 "Invalid or expired session."` — treat it
   as "session over, sign in again".

---

## Signing out

```http
POST /api/v1/auth/logout
{ "refreshToken": "<stored refresh token>" }
```

Returns **204 with an empty body** — do not parse it. Idempotent, and needs no
auth header. Clear both tokens locally afterwards.

---

## Password reset

```http
POST /api/v1/auth/forgot-password   { "email": "..." }
POST /api/v1/auth/reset-password    { "email": "...", "otp": "123456", "newPassword": "..." }
```

The OTP is **6 digits**. Drivers use `/drivers/forgot-password` and
`/drivers/reset-password`.

**This cannot work in production today.** No email provider is configured, so
the code is never delivered. Either hide the "forgot password" option for now,
or leave it and expect support requests. It starts working with no client
change once `SENDGRID_API_KEY` and `SENDGRID_FROM_EMAIL` are set.

---

## Rate limits

Per IP, Redis-backed. All three apply at once:

| Window | Limit |
|---|---|
| 1 second | 10 |
| 60 seconds | 120 |
| 1 hour | 2000 |

Auth endpoints are much tighter: **register, login, forgot-password and
reset-password allow 5 per minute.** A user mistyping their password five times
will be rate-limited — show a clear "too many attempts, wait a minute" rather
than "login failed".

Privy sign-in allows 10/min; refresh allows 30/min.

A 429 looks like:

```json
{ "success": false, "statusCode": 429,
  "message": "ThrottlerException: Too Many Requests", "code": "RATE_LIMITED" }
```

**Do not poll ride status every second.** With a 120/min budget you exhaust the
whole allowance in two minutes and start 429ing the user's other actions. Use
the websocket (namespace `/rides`, `auth: { token }` in the handshake), or poll
no faster than every 10–15 seconds.

---

## Quick reference

| Endpoint | Body key for identity | Notes |
|---|---|---|
| `POST /auth/register` | `user` | + `token` alias. No OTP step |
| `POST /auth/login` | `user` | + `token` alias |
| `POST /auth/privy` | **`profile`** | no `token` alias |
| `POST /auth/privy/driver-register` | `driver` | `vehicleYear` as **string** |
| `POST /drivers/register` | `driver` | `vehicleYear` as **number** |
| `POST /drivers/login` | `driver` | |
| `POST /auth/refresh` | — | rotates; store the new refresh token |
| `POST /auth/logout` | — | **204, empty body** |

## Things that will bite you

1. **No OTP after registration.** The endpoints exist and always fail.
2. **Three different phone rules.** Rider register wants bare digits; driver
   register wants `+234`/`0` prefixed; driver *update* is stricter still.
3. **`vehicleYear` is a number on one route and a string on another.**
4. **`okada` is not a vehicle type.** Use `bike`.
5. **Unknown fields are rejected**, not ignored. Send exactly what is listed.
6. **The identity key changes**: `user`, `profile`, or `driver` depending on the
   route. Normalise at your API layer, once.
7. **Concurrent refresh signs the user out everywhere.**
