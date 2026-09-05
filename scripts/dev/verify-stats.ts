/**
 * Run every StatsService query against a real Postgres with seeded data.
 *
 * The stats service is almost entirely SQL — EXTRACT, jsonb `->>`, TO_CHAR,
 * interval arithmetic, GROUP BY on enums. None of that is exercised by a unit
 * test with a mocked repository, and all of it fails at runtime rather than at
 * compile time. This script is how the queries are actually known to work.
 *
 * Development only. Requires the throwaway Postgres from the migration work.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as path from 'path';
import { StatsService } from '../../src/stats/stats.service';
import { Ride, RideStatus, RideCategory } from '../../src/rides/entities/ride.entity';
import { Driver, VerificationStatus } from '../../src/drivers/entities/driver.entity';
import { User } from '../../src/users/entities/user.entity';
import { Vehicle, VehicleType } from '../../src/vehicles/entities/vehicle.entity';
import {
  LedgerEntry,
  LedgerEntryType,
  LedgerEntryStatus,
  StakeholderType,
} from '../../src/ledger/entities/ledger-entry.entity';

const ds = new DataSource({
  type: 'postgres',
  host: process.env.SYNC_HOST ?? 'localhost',
  port: Number(process.env.SYNC_PORT ?? 55432),
  username: 'postgres',
  password: 'postgres',
  database: process.argv[2] ?? 'arkrides_stats',
  entities: [path.join(__dirname, '../../src/**/*.entity.ts')],
  synchronize: true,
  logging: false,
});

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

async function seed(): Promise<void> {
  const users = ds.getRepository(User);
  const drivers = ds.getRepository(Driver);
  const vehicles = ds.getRepository(Vehicle);
  const rides = ds.getRepository(Ride);
  const ledger = ds.getRepository(LedgerEntry);

  const rider = await users.save(
    users.create({ name: 'Amina Yusuf', email: 'amina@example.com' }),
  );
  const rider2 = await users.save(
    users.create({ name: 'Chidi Okeke', email: 'chidi@example.com' }),
  );

  const driver = await drivers.save(
    drivers.create({
      name: 'Musa Bello',
      email: 'musa@example.com',
      phone: '08011111111',
      password: 'x',
      licenseNumber: 'LIC-1',
      licenseExpiry: new Date('2030-01-01'),
      verificationStatus: VerificationStatus.APPROVED,
      isOnline: true,
    }),
  );
  const pending = await drivers.save(
    drivers.create({
      name: 'Ngozi Eze',
      email: 'ngozi@example.com',
      phone: '08022222222',
      password: 'x',
      licenseNumber: 'LIC-2',
      licenseExpiry: new Date('2030-01-01'),
      verificationStatus: VerificationStatus.PENDING,
    }),
  );

  await vehicles.save(
    vehicles.create({
      driverId: driver.id,
      type: VehicleType.KEKE,
      plateNumber: 'ABC-111',
      color: 'Yellow',
      model: 'Bajaj RE',
      year: 2023,
    }),
  );

  const ikeja = { address: 'Allen Avenue, Ikeja', lat: 6.6, lng: 3.35 };
  const yaba = { address: 'Herbert Macaulay Way, Yaba', lat: 6.5, lng: 3.37 };

  // Two completed rides, with the full timing chain so the wait/trip averages
  // have something to measure.
  //
  // Anchored to just after local midnight rather than "N hours ago": the
  // latter puts a ride into YESTERDAY whenever the suite runs in the small
  // hours, and `completedRidesToday` then fails for a reason that has nothing
  // to do with the code.
  const todayAt = (minutesAfterMidnight: number): Date => {
    const d = new Date();
    d.setHours(0, minutesAfterMidnight, 0, 0);
    return d;
  };
  for (const [index, minutes] of [[0, 60], [1, 180]] as Array<[number, number]>) {
    await rides.save(
      rides.create({
        userId: rider.id,
        driverId: driver.id,
        pickup: ikeja,
        dropoff: yaba,
        distanceKm: 8.5,
        category: RideCategory.PRIVATE,
        estimatedFare: 2000,
        finalFare: 2000,
        status: RideStatus.COMPLETED,
        requestedAt: todayAt(minutes),
        acceptedAt: new Date(todayAt(minutes).getTime() + 4 * 60_000),
        startedAt: new Date(todayAt(minutes).getTime() + 6 * 60_000),
        completedAt: new Date(todayAt(minutes).getTime() + 26 * 60_000),
      }),
    );
  }

  // One in flight, one cancelled, one waiting for a driver.
  await rides.save(
    rides.create({
      userId: rider2.id, driverId: driver.id, pickup: ikeja, dropoff: yaba,
      distanceKm: 4, category: RideCategory.OKADA, estimatedFare: 900,
      status: RideStatus.IN_PROGRESS, requestedAt: hoursAgo(1),
      acceptedAt: hoursAgo(1), startedAt: hoursAgo(1),
    }),
  );
  await rides.save(
    rides.create({
      userId: rider2.id, pickup: yaba, dropoff: ikeja, distanceKm: 8,
      category: RideCategory.SHARED, estimatedFare: 1200,
      status: RideStatus.CANCELLED, requestedAt: hoursAgo(2),
    }),
  );
  await rides.save(
    rides.create({
      userId: rider.id, pickup: ikeja, dropoff: yaba, distanceKm: 8.5,
      category: RideCategory.PRIVATE, estimatedFare: 2000,
      status: RideStatus.REQUESTED, requestedAt: hoursAgo(0),
    }),
  );

  // The 95/4/1 split for both completed rides.
  for (let i = 0; i < 2; i += 1) {
    await ledger.save([
      ledger.create({
        type: LedgerEntryType.RIDE_FARE_DRIVER,
        stakeholderType: StakeholderType.DRIVER,
        stakeholderId: driver.id, amount: 1900,
        status: LedgerEntryStatus.COMPLETED,
      }),
      ledger.create({
        type: LedgerEntryType.RIDE_FARE_PLATFORM,
        stakeholderType: StakeholderType.PLATFORM,
        stakeholderId: null, amount: 80,
        status: LedgerEntryStatus.COMPLETED,
      }),
      ledger.create({
        type: LedgerEntryType.RIDE_FARE_RIDER_CASHBACK,
        stakeholderType: StakeholderType.RIDER,
        stakeholderId: rider.id, amount: 20,
        status: LedgerEntryStatus.COMPLETED,
      }),
    ]);
  }

  // A pending withdrawal, to prove settled figures exclude it.
  await ledger.save(
    ledger.create({
      type: LedgerEntryType.DRIVER_PAYOUT_LINKPAY,
      stakeholderType: StakeholderType.DRIVER,
      stakeholderId: driver.id, amount: -500,
      status: LedgerEntryStatus.PENDING,
    }),
  );

  console.log(`seeded: riders=2 drivers=2 (1 approved) rides=5 ledger=7`);
}

/** Assertions on the seeded numbers. Any failure exits non-zero. */
const failures: string[] = [];
/** Sort object keys so a comparison is about VALUES, not insertion order. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected));
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
  if (!ok) failures.push(label);
}

async function main(): Promise<void> {
  await ds.initialize();
  await ds.query(
    'TRUNCATE ledger_entries, ratings, emergency_incidents, rides, vehicles, driver_locations, drivers, users RESTART IDENTITY CASCADE',
  );
  await seed();

  const service = new StatsService(
    ds.getRepository(Ride), ds.getRepository(Driver), ds.getRepository(User),
    ds.getRepository(Vehicle), ds.getRepository(LedgerEntry),
  );

  console.log('\n--- getPublicStats');
  const pub = await service.getPublicStats();
  check('completedRides', pub.completedRides, 2);
  check('activeDrivers (approved only)', pub.activeDrivers, 1);
  check('riders', pub.riders, 2);
  // /stats/public deliberately no longer returns pickup ADDRESSES — on modest
  // volume those are individual riders' homes. Only the count of distinct
  // areas served is public.
  check('coverageAreas (count, not addresses)', pub.coverageAreas, 2);
  check('no addresses in the public payload',
    JSON.stringify(pub).includes('Allen Avenue'), false);

  console.log('\n--- getDashboard');
  const dash = await service.getDashboard();
  check('activeRides (in flight, excludes requested)', dash.activeRides, 1);
  check('unassignedRides', dash.unassignedRides, 1);
  check('completedRidesToday', dash.completedRidesToday, 2);
  check('platformRevenue (4% x2)', dash.platformRevenue, 160);
  check('pendingPayouts (magnitude)', dash.pendingPayouts, 500);

  console.log('\n--- getRideStats');
  const ride = await service.getRideStats();
  check('totalRides', ride.totalRides, 5);
  check('ridesByStatus', ride.ridesByStatus, {
    completed: 2, in_progress: 1, cancelled: 1, requested: 1,
  });
  check('ridesByCategory', ride.ridesByCategory, {
    private: 3, okada: 1, shared: 1,
  });
  check('ridesByOriginChannel', ride.ridesByOriginChannel, { app: 5 });
  check('cancellationRate (1 of 3 terminal)', ride.cancellationRate, 33.3);
  check('totalDistanceKm (completed only)', ride.totalDistanceKm, 17);
  check('averageWaitMinutes', ride.averageWaitMinutes, 4);
  check('averageTripMinutes', ride.averageTripMinutes, 20);
  check('ridesByHour length (all 24)', ride.ridesByHour.length, 24);
  check('ridesByHour sums to totalRides',
    ride.ridesByHour.reduce((s, h) => s + h.rides, 0), 5);

  console.log('\n--- getRevenueStats');
  const rev = await service.getRevenueStats();
  check('platformRevenue', rev.platformRevenue, 160);
  check('driverEarnings', rev.driverEarnings, 3800);
  check('riderCashback', rev.riderCashback, 40);
  check('grossSettledFare (2 x 2000)', rev.grossSettledFare, 4000);
  check('driverPayouts (pending excluded from settled)', rev.driverPayouts, 0);
  check('pendingFareValue (in-flight ride)', rev.pendingFareValue, 900);
  check('cancelledFareValue', rev.cancelledFareValue, 1200);
  check('platformRevenueByDay has today', rev.platformRevenueByDay.length, 1);

  console.log('\n--- getDriverStats');
  const drv = await service.getDriverStats();
  check('totalDrivers', drv.totalDrivers, 2);
  check('byVerificationStatus (rejected present as 0)',
    drv.driversByVerificationStatus, { pending: 1, approved: 1, rejected: 0 });
  check('onlineNow', drv.onlineNow, 1);
  check('approvedButOffline', drv.approvedButOffline, 0);
  check('vehiclesByType (all types present)', drv.vehiclesByType,
    { keke: 1, bike: 0, car: 0, courier: 0 });
  check('topEarningDrivers', drv.topEarningDrivers,
    [{ driverId: drv.topEarningDrivers[0]?.driverId, name: 'Musa Bello', earnings: 3800, completedRides: 2 }]);

  console.log('\n--- empty database (every query must survive zero rows)');
  await ds.query('TRUNCATE ledger_entries, ratings, emergency_incidents, rides, vehicles, driver_locations, drivers, users RESTART IDENTITY CASCADE');
  const emptyRide = await service.getRideStats();
  const emptyRev = await service.getRevenueStats();
  const emptyDrv = await service.getDriverStats();
  await service.getPublicStats();
  await service.getDashboard();
  check('empty: totalRides', emptyRide.totalRides, 0);
  check('empty: cancellationRate is 0 not NaN', emptyRide.cancellationRate, 0);
  check('empty: averageTripMinutes is 0', emptyRide.averageTripMinutes, 0);
  check('empty: platformRevenue', emptyRev.platformRevenue, 0);
  check('empty: topEarningDrivers', emptyDrv.topEarningDrivers, []);
  check('empty: ridesByHour still 24 buckets', emptyRide.ridesByHour.length, 24);

  await ds.destroy();
  console.log(failures.length === 0
    ? '\n==> ALL STATS QUERIES VERIFIED AGAINST POSTGRES'
    : `\n==> ${failures.length} FAILED: ${failures.join(', ')}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
