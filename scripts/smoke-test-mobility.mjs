/**
 * End-to-end smoke test for the Ark Rides mobility upgrade.
 *
 * Exercises: car fleet class -> omnichannel booking -> realtime propagation
 * -> SOS -> fare split -> ledger -> wallet payout.
 */
import { io } from 'socket.io-client';
import { execSync } from 'child_process';

const BASE = 'http://localhost:4010';
const INTERNAL_KEY = 'test-internal-key';
const stamp = Date.now();

const log = (...a) => console.log(...a);
const ok = (label) => log(`  ✅ ${label}`);
const fail = (label, detail) => {
  log(`  ❌ ${label}: ${detail}`);
  failures.push(label);
};
const failures = [];

async function api(path, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

const sql = (q) =>
  execSync(
    `docker exec arkrides-postgres-dev psql -U postgres -d arkrides -t -A -c "${q}"`,
  ).toString().trim();

const events = { rider: [], driver: [] };

async function main() {
  log('\n═══ 1. Accounts ═══');

  // --- Rider ---
  const riderEmail = `rider${stamp}@test.local`;
  const riderPhone = `080${String(stamp).slice(-8)}`;
  let r = await api('/api/v1/auth/register', {
    method: 'POST',
    body: {
      name: 'Test Rider', email: riderEmail, phone: riderPhone,
      password: 'Password123!', confirmPassword: 'Password123!', acceptTerms: true,
    },
  });
  r.status < 300 ? ok('rider registered') : fail('rider register', JSON.stringify(r.body));

  // Registration auto-verifies today (auth.service.ts sets isVerified: true and
  // leaves otpCode null), so there is no OTP step to run here. Assert the state
  // rather than calling verify-otp, which would fail with an empty code.
  const verified = sql(`SELECT \\"isVerified\\" FROM users WHERE email='${riderEmail}'`);
  verified === 't' ? ok('rider verified (auto)') : fail('rider verify', `isVerified=${verified}`);

  r = await api('/api/v1/auth/login', {
    method: 'POST', body: { email: riderEmail, password: 'Password123!' },
  });
  const riderToken = r.body?.access_token || r.body?.accessToken || r.body?.token || r.body?.data?.access_token;
  riderToken ? ok('rider logged in') : fail('rider login', JSON.stringify(r.body));
  const riderId = sql(`SELECT id FROM users WHERE email='${riderEmail}'`);

  // --- Driver (with a CAR) ---
  const driverEmail = `driver${stamp}@test.local`;
  r = await api('/api/v1/drivers/register', {
    method: 'POST',
    body: {
      name: 'Test Driver', phone: `081${String(stamp).slice(-8)}`, email: driverEmail,
      password: 'Password123!', licenseNumber: `LIC${stamp}`,
      licenseExpiry: '2030-01-01', vehicleType: 'car',
      plateNumber: `ABC-${String(stamp).slice(-4)}`, vehicleColor: 'Black',
      vehicleModel: 'Toyota Corolla', vehicleYear: 2020,
    },
  });
  r.status < 300 ? ok('driver registered') : fail('driver register', JSON.stringify(r.body));
  const driverId = sql(`SELECT id FROM drivers WHERE email='${driverEmail}'`);

  // Approve + verify so the driver can work
  sql(`UPDATE drivers SET \\"verificationStatus\\"='approved' WHERE id='${driverId}'`);

  r = await api('/api/v1/drivers/login', {
    method: 'POST', body: { email: driverEmail, password: 'Password123!' },
  });
  const driverToken = r.body?.access_token || r.body?.accessToken || r.body?.token || r.body?.data?.access_token;
  driverToken ? ok('driver logged in') : fail('driver login', JSON.stringify(r.body));

  // Ensure a CAR vehicle exists
  let vehicleId = sql(`SELECT id FROM vehicles WHERE \\"driverId\\"='${driverId}' AND type='car' LIMIT 1`);
  if (!vehicleId) {
    r = await api('/api/v1/vehicles', {
      method: 'POST', token: driverToken,
      body: {
        driverId, type: 'car', plateNumber: `XYZ-${String(stamp).slice(-4)}`,
        color: 'Black', model: 'Toyota Corolla', year: 2020,
      },
    });
    vehicleId = r.body?.vehicle?.id || r.body?.id;
  }
  vehicleId ? ok(`car vehicle ready (${vehicleId.slice(0, 8)})`) : fail('vehicle', JSON.stringify(r.body));

  r = await api(`/api/v1/drivers/${driverId}/online-status`, {
    method: 'PATCH', token: driverToken, body: { isOnline: true },
  });
  r.status < 300 ? ok('driver online') : fail('driver online', JSON.stringify(r.body));

  log('\n═══ 2. Car fare estimates (4 options) ═══');
  r = await api('/api/v1/rides/estimate', {
    method: 'POST', token: riderToken,
    body: {
      pickup: { address: 'FUTA', lat: 7.3008, lng: 5.1352 },
      dropoff: { address: 'Market Square', lat: 7.2526, lng: 5.1931 },
    },
  });
  const estimates = r.body?.estimates || [];
  const car = estimates.find((e) => e.category === 'car');
  estimates.length === 4 ? ok(`4 options returned`) : fail('estimates', `got ${estimates.length}`);
  car ? ok(`car priced at ₦${car.estimatedFare} for ${car.distanceKm}km`) : fail('car option', 'missing');

  log('\n═══ 3. Realtime sockets connect ═══');
  const riderSock = io(`${BASE}/rides`, { auth: { token: riderToken }, transports: ['websocket'] });
  const driverSock = io(`${BASE}/rides`, { auth: { token: driverToken }, transports: ['websocket'] });

  for (const [name, sock, bucket] of [['rider', riderSock, events.rider], ['driver', driverSock, events.driver]]) {
    ['ride:requested','ride:accepted','ride:arrived','ride:started','ride:completed','ride:cancelled','ride:taken','driver:location','sos:triggered','auth:error']
      .forEach((evt) => sock.on(evt, (payload) => bucket.push({ evt, payload })));
  }

  await new Promise((resolve) => {
    let n = 0;
    const done = () => (++n === 2 ? resolve() : null);
    riderSock.on('connect', done);
    driverSock.on('connect', done);
    setTimeout(resolve, 4000);
  });
  riderSock.connected ? ok('rider socket connected') : fail('rider socket', 'not connected');
  driverSock.connected ? ok('driver socket connected') : fail('driver socket', 'not connected');

  // Rejects a bad token
  const badSock = io(`${BASE}/rides`, { auth: { token: 'garbage' }, transports: ['websocket'] });
  const rejected = await new Promise((resolve) => {
    badSock.on('auth:error', () => resolve(true));
    badSock.on('disconnect', () => resolve(true));
    setTimeout(() => resolve(false), 4000);
  });
  rejected ? ok('bad token rejected') : fail('bad token', 'was not rejected');
  badSock.close();

  log('\n═══ 4. Omnichannel booking (WhatsApp NLP) ═══');
  // Ambiguous message first
  r = await api('/api/v1/booking-channels/parse-and-book', {
    method: 'POST', headers: { 'x-internal-api-key': INTERNAL_KEY },
    body: { rawText: 'Book me a ride', channel: 'whatsapp', callerPhone: '+2348012345678' },
  });
  r.body?.status === 'clarification_needed'
    ? ok(`ambiguous -> 200 "${r.body.message}"`)
    : fail('ambiguity', JSON.stringify(r.body));

  // Real booking
  r = await api('/api/v1/booking-channels/parse-and-book', {
    method: 'POST', headers: { 'x-internal-api-key': INTERNAL_KEY },
    body: {
      rawText: 'Book a car from FUTA to Market Square',
      channel: 'whatsapp',
      callerPhone: riderPhone.startsWith('0') ? riderPhone : `0${riderPhone}`,
      pickup: { address: 'FUTA', lat: 7.3008, lng: 5.1352 },
      dropoff: { address: 'Market Square', lat: 7.2526, lng: 5.1931 },
    },
  });
  const ride = r.body?.ride;
  ride ? ok(`booked ride ${ride.id.slice(0, 8)} category=${ride.category} channel=${ride.originChannel}`)
       : fail('nlp booking', JSON.stringify(r.body));
  if (!ride) { summary(); return; }

  // No key = rejected
  const noKey = await api('/api/v1/booking-channels/parse-and-book', {
    method: 'POST',
    body: { rawText: 'Book a car from FUTA to Market Square', channel: 'whatsapp', callerPhone: '+2348011111111' },
  });
  noKey.status === 401 ? ok('missing api key rejected (401)') : fail('api key guard', `status ${noKey.status}`);

  const rideId = ride.id;
  const bookedRiderId = ride.userId;

  log('\n═══ 5. Ride lifecycle ═══');
  await sleep(600);

  r = await api(`/api/v1/rides/${rideId}/accept`, {
    method: 'PATCH', token: driverToken, body: { status: 'accepted', vehicleId },
  });
  r.status < 300 ? ok('driver accepted') : fail('accept', JSON.stringify(r.body));
  await sleep(600);

  // Driver location ping should now reach the ride room
  r = await api('/api/v1/driver-locations', {
    method: 'POST', token: driverToken, body: { latitude: 7.29, longitude: 5.15 },
  });
  await sleep(600);

  r = await api(`/api/v1/rides/${rideId}/arrived`, { method: 'PATCH', token: driverToken });
  r.status < 300 ? ok('driver arrived') : fail('arrived', JSON.stringify(r.body));
  await sleep(500);

  r = await api(`/api/v1/rides/${rideId}/start`, { method: 'PATCH', token: driverToken });
  r.status < 300 ? ok('ride started') : fail('start', JSON.stringify(r.body));
  await sleep(500);

  log('\n═══ 6. SOS mid-ride ═══');
  r = await api('/api/v1/emergency/trigger', {
    method: 'POST', token: riderToken, body: { rideId, note: 'Test alarm' },
  });
  r.status < 300 ? ok(`SOS raised, incident ${r.body?.incident?.id?.slice(0, 8)}`) : fail('sos', JSON.stringify(r.body));
  await sleep(700);

  log('\n═══ 7. Completion + 95/4/1 split ═══');
  const estimatedFare = Number(sql(`SELECT \\"estimatedFare\\" FROM rides WHERE id='${rideId}'`));
  r = await api(`/api/v1/rides/${rideId}/complete`, { method: 'PATCH', token: driverToken });
  r.status < 300 ? ok(`ride completed, fare ₦${estimatedFare}`) : fail('complete', JSON.stringify(r.body));
  await sleep(800);

  const ledgerRows = sql(`SELECT type || '=' || amount FROM ledger_entries WHERE \\"rideId\\"='${rideId}' ORDER BY type`);
  log(`     ledger: ${ledgerRows.split('\n').join(' | ')}`);

  const sum = Number(sql(`SELECT COALESCE(SUM(amount),0) FROM ledger_entries WHERE \\"rideId\\"='${rideId}'`));
  Math.abs(sum - estimatedFare) < 0.005
    ? ok(`split sums exactly to fare (${sum} == ${estimatedFare})`)
    : fail('split sum', `${sum} != ${estimatedFare}`);

  const driverAmt = Number(sql(`SELECT amount FROM ledger_entries WHERE \\"rideId\\"='${rideId}' AND type='ride_fare_driver'`));
  const platformAmt = Number(sql(`SELECT amount FROM ledger_entries WHERE \\"rideId\\"='${rideId}' AND type='ride_fare_platform'`));
  const riderAmt = Number(sql(`SELECT amount FROM ledger_entries WHERE \\"rideId\\"='${rideId}' AND type='ride_fare_rider_cashback'`));
  Math.abs(driverAmt - estimatedFare * 0.95) < 1 ? ok(`driver 95% = ₦${driverAmt}`) : fail('driver share', driverAmt);
  Math.abs(platformAmt - estimatedFare * 0.04) < 1 ? ok(`platform 4% = ₦${platformAmt}`) : fail('platform share', platformAmt);
  Math.abs(riderAmt - estimatedFare * 0.01) < 1 ? ok(`rider 1% = ₦${riderAmt}`) : fail('rider share', riderAmt);

  const cashback = Number(sql(`SELECT \\"cashbackBalance\\" FROM users WHERE id='${bookedRiderId}'`));
  Math.abs(cashback - riderAmt) < 0.005 ? ok(`rider cashback balance credited ₦${cashback}`) : fail('cashback balance', cashback);

  const wallet = Number(sql(`SELECT \\"walletBalance\\" FROM drivers WHERE id='${driverId}'`));
  Math.abs(wallet - driverAmt) < 0.005 ? ok(`driver wallet credited ₦${wallet}`) : fail('wallet balance', wallet);

  log('\n═══ 8. Idempotency: replay completion ═══');
  r = await api(`/api/v1/rides/${rideId}/complete`, { method: 'PATCH', token: driverToken });
  await sleep(400);
  const walletAfter = Number(sql(`SELECT \\"walletBalance\\" FROM drivers WHERE id='${driverId}'`));
  const rowsAfter = Number(sql(`SELECT COUNT(*) FROM ledger_entries WHERE \\"rideId\\"='${rideId}'`));
  walletAfter === wallet && rowsAfter === 3
    ? ok(`replay is a no-op (wallet ₦${walletAfter}, ${rowsAfter} ledger rows)`)
    : fail('idempotency', `wallet ${walletAfter}, rows ${rowsAfter}`);

  log('\n═══ 9. Breakdown endpoint ═══');
  r = await api(`/api/v1/rides/${rideId}/breakdown`, { token: riderToken });
  r.body?.settled === true
    ? ok(`breakdown: driver ₦${r.body.driverEarning} / platform ₦${r.body.platformCommission} / rider ₦${r.body.riderCashback}`)
    : fail('breakdown', JSON.stringify(r.body));

  log('\n═══ 10. Wallet: MFB fuel support + LinkPay payout ═══');
  r = await api('/api/v1/wallet/fuel-support/limit', { token: driverToken });
  ok(`fuel allowance: ₦${r.body?.remaining} of ₦${r.body?.dailyLimit}`);

  r = await api('/api/v1/wallet/fuel-support/request', {
    method: 'POST', token: driverToken, body: { amount: 2000 },
  });
  r.status < 300 ? ok(`fuel support granted, balance ₦${r.body?.walletBalance}`) : fail('fuel support', JSON.stringify(r.body));

  r = await api('/api/v1/wallet/fuel-support/request', {
    method: 'POST', token: driverToken, body: { amount: 9000 },
  });
  r.status === 400 ? ok('over-limit fuel request rejected') : fail('fuel limit', `status ${r.status}`);

  r = await api('/api/v1/wallet/payout', {
    method: 'POST', token: driverToken,
    body: { amount: 1000, bankAccount: { accountNumber: '0123456789', bankCode: '058' } },
  });
  r.status < 300 ? ok(`payout submitted (${r.body?.status}), balance ₦${r.body?.walletBalance}`) : fail('payout', JSON.stringify(r.body));

  r = await api('/api/v1/wallet/payout', {
    method: 'POST', token: driverToken,
    body: { amount: 9999999, bankAccount: { accountNumber: '0123456789', bankCode: '058' } },
  });
  r.status === 400 ? ok('over-balance payout rejected') : fail('payout limit', `status ${r.status}`);

  log('\n═══ 11. Realtime events actually received ═══');
  const riderEvts = events.rider.map((e) => e.evt);
  const driverEvts = events.driver.map((e) => e.evt);
  log(`     rider  saw: ${[...new Set(riderEvts)].join(', ') || '(none)'}`);
  log(`     driver saw: ${[...new Set(driverEvts)].join(', ') || '(none)'}`);

  const expectRider = ['ride:accepted', 'ride:arrived', 'ride:started', 'ride:completed', 'sos:triggered', 'driver:location'];
  expectRider.forEach((evt) =>
    riderEvts.includes(evt) ? ok(`rider received ${evt}`) : fail(`rider ${evt}`, 'not received'),
  );
  driverEvts.includes('ride:requested') ? ok('driver received ride:requested') : fail('driver ride:requested', 'not received');

  const completed = events.rider.find((e) => e.evt === 'ride:completed');
  completed?.payload?.split
    ? ok(`completion event carried split: ${JSON.stringify(completed.payload.split)}`)
    : fail('completion split payload', 'missing');

  riderSock.close();
  driverSock.close();
  summary();
}

function summary() {
  log('\n' + '═'.repeat(60));
  if (failures.length === 0) log('🎉 ALL CHECKS PASSED');
  else log(`⚠️  ${failures.length} FAILED: ${failures.join(', ')}`);
  log('═'.repeat(60) + '\n');
  process.exit(failures.length ? 1 : 0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
