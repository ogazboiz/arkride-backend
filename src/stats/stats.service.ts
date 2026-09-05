import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ride, RideStatus, RideCategory } from '../rides/entities/ride.entity';
import { Vehicle, VehicleType } from '../vehicles/entities/vehicle.entity';
import { Driver, VerificationStatus } from '../drivers/entities/driver.entity';
import { User } from '../users/entities/user.entity';
import {
  LedgerEntry,
  LedgerEntryType,
  LedgerEntryStatus,
  StakeholderType,
} from '../ledger/entities/ledger-entry.entity';

/**
 * Operational and financial analytics.
 *
 * TWO THINGS TO KNOW ABOUT HOW THIS IS BUILT
 *
 * 1. TIME WINDOWS ARE COMPUTED PER CALL, never at module load. A reference
 *    implementation this was modelled on hoisted `const now = new Date()` to
 *    module scope; on a long-lived Nest process "today" and "last 7 days"
 *    freeze at boot and drift further from the truth every day the container
 *    stays up. The bug is invisible in testing, because a freshly started
 *    process is always right.
 *
 * 2. MONEY COMES FROM THE LEDGER, not from summing `rides.finalFare`.
 *    `ledger_entries` is the audit trail every naira actually moves through,
 *    with a unique partial index that makes double-paying a ride structurally
 *    impossible. Deriving revenue from the rides table instead would report a
 *    number that no financial record backs, and the two would silently
 *    disagree the first time a fare split was ever adjusted or reversed.
 *
 *    It also means platform revenue is real: the 4% commission rows, summed —
 *    not gross fare, which is mostly the driver's money passing through.
 */
@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(Ride) private readonly rides: Repository<Ride>,
    @InjectRepository(Driver) private readonly drivers: Repository<Driver>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(LedgerEntry)
    private readonly ledger: Repository<LedgerEntry>,
  ) {}

  /**
   * Numbers safe to show an anonymous visitor on the marketing site.
   *
   * Nothing here identifies a person or reveals commercial position: counts,
   * and the names of places served. Deliberately NOT here: revenue, driver
   * earnings, or anything that would let a competitor size the business.
   */
  async getPublicStats() {
    const [completedRides, activeDrivers, riders, coverageAreas] =
      await Promise.all([
        this.rides.count({ where: { status: RideStatus.COMPLETED } }),
        this.drivers.count({
          where: {
            verificationStatus: VerificationStatus.APPROVED,
            isActive: true,
          },
        }),
        this.users.count(),
        this.distinctPickupAreas(),
      ]);

    return {
      // Rounded DOWN to a marketing figure, not reported exactly.
      //
      // The first version returned precise counts and the five most frequent
      // pickup ADDRESSES. On a platform with modest volume those addresses are
      // individual riders' homes — which is the opposite of this endpoint's
      // own promise that nothing here identifies a person — and polling the
      // exact counts daily hands a competitor the growth curve.
      //
      // A number a marketing page can print is all this needs to be.
      completedRides: roundDownToMilestone(completedRides),
      activeDrivers: roundDownToMilestone(activeDrivers),
      riders: roundDownToMilestone(riders),
      /** How many distinct areas are served. No addresses. */
      coverageAreas,
      vehicleTypesOffered: Object.values(VehicleType),
      rideCategoriesOffered: Object.values(RideCategory),
    };
  }

  /** How many distinct pickup areas have ever been served. */
  private async distinctPickupAreas(): Promise<number> {
    const row = await this.rides
      .createQueryBuilder('ride')
      .select("COUNT(DISTINCT ride.pickup ->> 'address')", 'count')
      .getRawOne<{ count: string }>();
    return Number(row?.count ?? 0);
  }

  /** The admin landing page: the handful of numbers worth waking up to. */
  async getDashboard() {
    const { startOfToday, sevenDaysAgo } = windows();

    const [
      totalUsers,
      totalDrivers,
      totalRides,
      activeRides,
      completedToday,
      newUsersThisWeek,
      newDriversThisWeek,
      platformRevenue,
      pendingPayouts,
    ] = await Promise.all([
      this.users.count(),
      this.drivers.count(),
      this.rides.count(),
      // In flight RIGHT NOW: accepted through to in-progress. Deliberately
      // excludes `requested`, which is demand nobody has picked up — that is
      // a different number, and conflating them hides a dispatch failure.
      this.rides
        .createQueryBuilder('ride')
        .where('ride.status IN (:...statuses)', { statuses: IN_FLIGHT })
        .getCount(),
      this.rides
        .createQueryBuilder('ride')
        .where('ride.status = :status', { status: RideStatus.COMPLETED })
        .andWhere('ride.completedAt >= :from', { from: startOfToday })
        .getCount(),
      this.users
        .createQueryBuilder('user')
        .where('user.createdAt >= :from', { from: sevenDaysAgo })
        .getCount(),
      this.drivers
        .createQueryBuilder('driver')
        .where('driver.createdAt >= :from', { from: sevenDaysAgo })
        .getCount(),
      this.sumLedger({ stakeholderType: StakeholderType.PLATFORM }),
      this.sumLedger({
        type: LedgerEntryType.DRIVER_PAYOUT_LINKPAY,
        status: LedgerEntryStatus.PENDING,
      }),
    ]);

    const unassigned = await this.rides.count({
      where: { status: RideStatus.REQUESTED },
    });

    return {
      totalUsers,
      totalDrivers,
      totalRides,
      activeRides,
      /**
       * Requested and nobody has accepted. This is the number that says
       * "dispatch is failing", and it is the reason `activeRides` above does
       * not quietly include it.
       */
      unassignedRides: unassigned,
      completedRidesToday: completedToday,
      newUsersThisWeek,
      newDriversThisWeek,
      /** The platform's own 4% cut, from the ledger. Not gross fare. */
      platformRevenue,
      /** Withdrawals written but not yet confirmed by the payout provider. */
      pendingPayouts: Math.abs(pendingPayouts),
    };
  }

  /** Ride volume, mix, and where demand actually is. */
  async getRideStats() {
    const { startOfToday, sevenDaysAgo, thirtyDaysAgo } = windows();

    const [
      byStatus,
      byCategory,
      byChannel,
      distance,
      today,
      week,
      month,
      byHour,
      topPickups,
      topDropoffs,
      duration,
    ] = await Promise.all([
      this.groupCount('status'),
      this.groupCount('category'),
      this.groupCount('originChannel'),
      this.rides
        .createQueryBuilder('ride')
        .select('COALESCE(SUM(ride.distanceKm), 0)', 'total')
        .addSelect('COALESCE(AVG(ride.distanceKm), 0)', 'average')
        .where('ride.status = :status', { status: RideStatus.COMPLETED })
        .getRawOne<{ total: string; average: string }>(),
      this.countSince(startOfToday),
      this.countSince(sevenDaysAgo),
      this.countSince(thirtyDaysAgo),
      this.ridesByHour(),
      this.topLocations('pickup', 10),
      this.topLocations('dropoff', 10),
      this.averageRideMinutes(),
    ]);

    const completed = byStatus[RideStatus.COMPLETED] ?? 0;
    const cancelled = byStatus[RideStatus.CANCELLED] ?? 0;
    const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0);

    return {
      totalRides: total,
      ridesByStatus: byStatus,
      ridesByCategory: byCategory,
      /** app vs WhatsApp vs voice — how much booking happens off-app. */
      ridesByOriginChannel: byChannel,
      completedRides: completed,
      cancelledRides: cancelled,
      /**
       * Cancelled as a share of rides that REACHED a terminal state. Dividing
       * by all rides would make the rate fall whenever a lot of trips are
       * mid-flight, which is exactly when you would be looking at it.
       */
      cancellationRate: ratio(cancelled, completed + cancelled),
      totalDistanceKm: money(distance?.total),
      averageDistanceKm: money(distance?.average),
      ridesToday: today,
      ridesLast7Days: week,
      ridesLast30Days: month,
      /** Demand by hour of day, for shift planning. */
      ridesByHour: byHour,
      topPickupLocations: topPickups,
      topDropoffLocations: topDropoffs,
      ...duration,
    };
  }

  /**
   * Where the money went.
   *
   * Every figure is a SUM over `ledger_entries`, so the four numbers reconcile
   * against each other and against the ride that produced them.
   */
  async getRevenueStats() {
    const { startOfToday, sevenDaysAgo, thirtyDaysAgo } = windows();

    const [
      platform,
      driverEarnings,
      riderCashback,
      fuelSupport,
      payouts,
      platformToday,
      platform7,
      platform30,
      byDay,
      inFlight,
      cancelledValue,
    ] = await Promise.all([
      this.sumLedger({ stakeholderType: StakeholderType.PLATFORM }),
      this.sumLedger({ type: LedgerEntryType.RIDE_FARE_DRIVER }),
      this.sumLedger({ type: LedgerEntryType.RIDE_FARE_RIDER_CASHBACK }),
      this.sumLedger({ type: LedgerEntryType.DRIVER_FUEL_SUPPORT_MFB }),
      this.sumLedger({ type: LedgerEntryType.DRIVER_PAYOUT_LINKPAY }),
      this.sumLedger(
        { stakeholderType: StakeholderType.PLATFORM },
        startOfToday,
      ),
      this.sumLedger(
        { stakeholderType: StakeholderType.PLATFORM },
        sevenDaysAgo,
      ),
      this.sumLedger(
        { stakeholderType: StakeholderType.PLATFORM },
        thirtyDaysAgo,
      ),
      this.platformRevenueByDay(30),
      this.inFlightFareValue(),
      this.cancelledFareValue(),
    ]);

    return {
      platformRevenue: platform,
      platformRevenueToday: platformToday,
      platformRevenueLast7Days: platform7,
      platformRevenueLast30Days: platform30,
      driverEarnings,
      riderCashback,
      /** Gross value settled — the three splits are 95/4/1 of this. */
      grossSettledFare: money(platform + driverEarnings + riderCashback),
      /** Fuel advances disbursed. Note: nothing repays these yet. */
      fuelSupportDisbursed: fuelSupport,
      /** Withdrawals are negative in the ledger; shown here as a magnitude. */
      driverPayouts: Math.abs(payouts),
      /**
       * Fare on rides accepted but not yet completed — money that will settle
       * if those trips finish. Not revenue, and deliberately not added to it.
       */
      pendingFareValue: inFlight,
      /**
       * Quoted fare on cancelled rides. Not a loss in any accounting sense —
       * nothing was ever charged — but it is the size of the demand that fell
       * through, which is what makes it worth watching.
       */
      cancelledFareValue: cancelledValue,
      platformRevenueByDay: byDay,
    };
  }

  /** Supply side: who is on the road, who earns, who is stuck in review. */
  async getDriverStats() {
    const [
      total,
      byVerification,
      online,
      approvedTotal,
      vehiclesByType,
      topEarners,
    ] = await Promise.all([
      this.drivers.count(),
      this.driversByVerification(),
      this.drivers.count({ where: { isOnline: true, isActive: true } }),
      this.drivers.count({
        where: { verificationStatus: VerificationStatus.APPROVED },
      }),
      this.vehiclesByType(),
      this.topEarningDrivers(10),
    ]);

    return {
      totalDrivers: total,
      driversByVerificationStatus: byVerification,
      onlineNow: online,
      approvedDrivers: approvedTotal,
      /**
       * Approved drivers who are not online. The gap between supply that
       * exists and supply that is available.
       */
      approvedButOffline: Math.max(approvedTotal - online, 0),
      vehiclesByType,
      topEarningDrivers: topEarners,
    };
  }

  // ---------------------------------------------------------------------
  // Query helpers
  // ---------------------------------------------------------------------

  /** `SUM(amount)` over the ledger, optionally from an instant. */
  private async sumLedger(
    where: Partial<Pick<LedgerEntry, 'type' | 'stakeholderType' | 'status'>>,
    since?: Date,
  ): Promise<number> {
    const query = this.ledger
      .createQueryBuilder('entry')
      .select('COALESCE(SUM(entry.amount), 0)', 'total');

    if (where.type) query.andWhere('entry.type = :type', { type: where.type });
    if (where.stakeholderType) {
      query.andWhere('entry.stakeholderType = :stakeholderType', {
        stakeholderType: where.stakeholderType,
      });
    }
    // Default to settled money. A caller asking specifically for PENDING gets
    // exactly that; everyone else must not have unconfirmed movements folded
    // into a revenue figure.
    query.andWhere('entry.status = :status', {
      status: where.status ?? LedgerEntryStatus.COMPLETED,
    });

    if (since) query.andWhere('entry.createdAt >= :since', { since });

    const row = await query.getRawOne<{ total: string }>();
    return money(row?.total);
  }

  /** `COUNT(*) GROUP BY <column>` over rides, as a plain object. */
  private async groupCount(
    column: 'status' | 'category' | 'originChannel',
  ): Promise<Record<string, number>> {
    const rows = await this.rides
      .createQueryBuilder('ride')
      .select(`ride.${column}`, 'key')
      .addSelect('COUNT(*)', 'count')
      .groupBy(`ride.${column}`)
      .getRawMany<{ key: string; count: string }>();

    return Object.fromEntries(rows.map((r) => [r.key, Number(r.count)]));
  }

  private countSince(from: Date): Promise<number> {
    return this.rides
      .createQueryBuilder('ride')
      .where('ride.createdAt >= :from', { from })
      .getCount();
  }

  /**
   * Busiest pickup or dropoff areas.
   *
   * Locations are jsonb `{ address, lat, lng }`, so this groups on the address
   * text. That is coarse — two spellings of one place are two rows — but it is
   * honest about the data that exists, and it is what the geocoding layer will
   * replace when there is a real one.
   */
  private async topLocations(
    field: 'pickup' | 'dropoff',
    limit: number,
  ): Promise<Array<{ address: string; rides: number }>> {
    const rows = await this.rides
      .createQueryBuilder('ride')
      .select(`ride.${field} ->> 'address'`, 'address')
      .addSelect('COUNT(*)', 'count')
      .where(`ride.${field} ->> 'address' IS NOT NULL`)
      .groupBy(`ride.${field} ->> 'address'`)
      .orderBy('COUNT(*)', 'DESC')
      .limit(limit)
      .getRawMany<{ address: string; count: string }>();

    return rows.map((r) => ({ address: r.address, rides: Number(r.count) }));
  }

  /** Requests per hour of day, 0-23, with empty hours present as zero. */
  private async ridesByHour(): Promise<Array<{ hour: number; rides: number }>> {
    const rows = await this.rides
      .createQueryBuilder('ride')
      .select('EXTRACT(HOUR FROM ride.requestedAt)::int', 'hour')
      .addSelect('COUNT(*)', 'count')
      .groupBy('EXTRACT(HOUR FROM ride.requestedAt)')
      .orderBy('1', 'ASC')
      .getRawMany<{ hour: number; count: string }>();

    const counts = new Map(rows.map((r) => [Number(r.hour), Number(r.count)]));
    // Emit all 24 hours. A sparse array makes a chart lie about the shape of
    // the day by closing the gaps.
    return Array.from({ length: 24 }, (_, hour) => ({
      hour,
      rides: counts.get(hour) ?? 0,
    }));
  }

  /**
   * How long trips take, split into the two halves that mean different things.
   *
   * A single request-to-completion average conflates "we could not find a
   * driver" with "the traffic was bad", and those have completely different
   * fixes. Waiting time is a dispatch problem; trip time is not.
   */
  private async averageRideMinutes(): Promise<{
    averageWaitMinutes: number;
    averageTripMinutes: number;
  }> {
    const row = await this.rides
      .createQueryBuilder('ride')
      .select(
        'COALESCE(AVG(EXTRACT(EPOCH FROM (ride.acceptedAt - ride.requestedAt)) / 60), 0)',
        'wait',
      )
      .addSelect(
        'COALESCE(AVG(EXTRACT(EPOCH FROM (ride.completedAt - ride.startedAt)) / 60), 0)',
        'trip',
      )
      .where('ride.status = :status', { status: RideStatus.COMPLETED })
      .andWhere('ride.acceptedAt IS NOT NULL')
      .andWhere('ride.startedAt IS NOT NULL')
      .getRawOne<{ wait: string; trip: string }>();

    return {
      averageWaitMinutes: money(row?.wait),
      averageTripMinutes: money(row?.trip),
    };
  }

  /** Platform commission per calendar day, most recent last. */
  private async platformRevenueByDay(
    days: number,
  ): Promise<Array<{ date: string; revenue: number }>> {
    const from = new Date();
    from.setDate(from.getDate() - days);
    from.setHours(0, 0, 0, 0);

    const rows = await this.ledger
      .createQueryBuilder('entry')
      .select("TO_CHAR(entry.createdAt, 'YYYY-MM-DD')", 'date')
      .addSelect('COALESCE(SUM(entry.amount), 0)', 'revenue')
      .where('entry.stakeholderType = :stakeholderType', {
        stakeholderType: StakeholderType.PLATFORM,
      })
      .andWhere('entry.status = :status', {
        status: LedgerEntryStatus.COMPLETED,
      })
      .andWhere('entry.createdAt >= :from', { from })
      .groupBy('1')
      .orderBy('1', 'ASC')
      .getRawMany<{ date: string; revenue: string }>();

    return rows.map((r) => ({ date: r.date, revenue: money(r.revenue) }));
  }

  /** Estimated fare on rides that are accepted but not finished. */
  private async inFlightFareValue(): Promise<number> {
    const row = await this.rides
      .createQueryBuilder('ride')
      .select('COALESCE(SUM(ride.estimatedFare), 0)', 'total')
      .where('ride.status IN (:...statuses)', { statuses: IN_FLIGHT })
      .getRawOne<{ total: string }>();
    return money(row?.total);
  }

  /** Quoted fare on cancelled rides — demand that fell through. */
  private async cancelledFareValue(): Promise<number> {
    const row = await this.rides
      .createQueryBuilder('ride')
      .select('COALESCE(SUM(ride.estimatedFare), 0)', 'total')
      .where('ride.status = :status', { status: RideStatus.CANCELLED })
      .getRawOne<{ total: string }>();
    return money(row?.total);
  }

  private async driversByVerification(): Promise<Record<string, number>> {
    const rows = await this.drivers
      .createQueryBuilder('driver')
      .select('driver.verificationStatus', 'key')
      .addSelect('COUNT(*)', 'count')
      .groupBy('driver.verificationStatus')
      .getRawMany<{ key: string; count: string }>();

    // Every status present, including the ones with nobody in them — a
    // missing `rejected` key reads as "no data" rather than "none".
    const base = Object.fromEntries(
      Object.values(VerificationStatus).map((status) => [status, 0]),
    );
    for (const row of rows) base[row.key] = Number(row.count);
    return base;
  }

  private async vehiclesByType(): Promise<Record<string, number>> {
    const rows = await this.vehicles
      .createQueryBuilder('vehicle')
      .select('vehicle.type', 'key')
      .addSelect('COUNT(*)', 'count')
      .where('vehicle.isActive = true')
      .groupBy('vehicle.type')
      .getRawMany<{ key: string; count: string }>();

    const base = Object.fromEntries(
      Object.values(VehicleType).map((type) => [type, 0]),
    );
    for (const row of rows) base[row.key] = Number(row.count);
    return base;
  }

  /**
   * Highest-earning drivers, from the LEDGER.
   *
   * Not from `drivers.walletBalance`, which is a spendable balance: a driver
   * who has withdrawn their money would drop off a leaderboard built on it,
   * which is the opposite of what a leaderboard means.
   */
  private async topEarningDrivers(limit: number): Promise<
    Array<{
      driverId: string;
      name: string;
      earnings: number;
      completedRides: number;
    }>
  > {
    const rows = await this.ledger
      .createQueryBuilder('entry')
      .select('entry.stakeholderId', 'driverId')
      .addSelect('COALESCE(SUM(entry.amount), 0)', 'earnings')
      .addSelect('COUNT(*)', 'rides')
      .where('entry.type = :type', { type: LedgerEntryType.RIDE_FARE_DRIVER })
      .andWhere('entry.status = :status', {
        status: LedgerEntryStatus.COMPLETED,
      })
      .andWhere('entry.stakeholderId IS NOT NULL')
      .groupBy('entry.stakeholderId')
      .orderBy('2', 'DESC')
      .limit(limit)
      .getRawMany<{ driverId: string; earnings: string; rides: string }>();

    if (rows.length === 0) return [];

    // One extra query for the names rather than a join, so the aggregate stays
    // a pure ledger read and the name lookup cannot change which drivers rank.
    const drivers = await this.drivers.find({
      where: rows.map((row) => ({ id: row.driverId })),
      select: { id: true, name: true },
    });
    const names = new Map(drivers.map((driver) => [driver.id, driver.name]));

    return rows.map((row) => ({
      driverId: row.driverId,
      name: names.get(row.driverId) ?? 'Unknown driver',
      earnings: money(row.earnings),
      completedRides: Number(row.rides),
    }));
  }
}

/** Statuses that mean a trip is underway. Excludes `requested`. */
const IN_FLIGHT = [
  RideStatus.ACCEPTED,
  RideStatus.ARRIVED,
  RideStatus.IN_PROGRESS,
];

/**
 * The timezone "today" means in.
 *
 * Ark Rides operates in Nigeria; the containers do not. `new Date().setHours(0)`
 * gives the SERVER's midnight, so a UTC container reports Lagos's 00:00-00:59
 * as yesterday, every single day. "Rides completed today" would be wrong for
 * the first hour of every morning — small enough to go unnoticed, large enough
 * to make an operator distrust the dashboard.
 *
 * Override with REPORTING_TIMEZONE for a deployment in another market.
 */
const REPORTING_TIMEZONE = process.env.REPORTING_TIMEZONE ?? 'Africa/Lagos';

/**
 * Time boundaries, computed FRESH on every call.
 *
 * Exported for the unit test, and separated out precisely because hoisting
 * these to module scope is the classic bug in this kind of service: on a
 * long-lived process "today" would freeze at boot and look correct in every
 * test, because a freshly started process is always right.
 */
export function windows(now: Date = new Date(), timeZone = REPORTING_TIMEZONE) {
  const daysAgo = (days: number): Date => {
    const date = new Date(now);
    date.setDate(date.getDate() - days);
    return date;
  };

  return {
    now,
    startOfToday: startOfDayIn(now, timeZone),
    sevenDaysAgo: daysAgo(7),
    thirtyDaysAgo: daysAgo(30),
  };
}

/**
 * The UTC offset of `timeZone` at a given instant, in milliseconds.
 *
 * Formats the instant as wall-clock time there, reads those fields back as if
 * they were UTC, and takes the difference. Correct across DST because it asks
 * about a specific instant rather than assuming a fixed offset.
 */
function offsetAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);

  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    // ICU renders midnight as 24 under hour12:false in some versions.
    get('hour') % 24,
    get('minute'),
    get('second'),
  );

  return asUtc - instant.getTime();
}

/**
 * The instant local midnight began in `timeZone`.
 *
 * NOT "now minus the wall-clock time elapsed today". That is the obvious
 * implementation and it is wrong on DST transition days: a spring-forward day
 * shows 24 hours on the clock but is only 23 hours long, so the subtraction
 * lands an hour early. Africa/Lagos has no DST and would never have surfaced
 * it — which is why it is worth getting right now rather than leaving as a
 * trap for whichever market is added next.
 *
 * Instead: take the calendar date in that zone, then solve for the instant
 * whose local time is 00:00 on it. The second pass re-reads the offset at the
 * candidate instant, and that is what makes a transition day come out right.
 *
 * Falls back to the server's own midnight for an invalid zone — a typo in
 * REPORTING_TIMEZONE must not 500 every stats request.
 *
 * Exported for the unit test; the interesting cases are all boundaries.
 */
export function startOfDayIn(now: Date, timeZone: string): Date {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);

    const get = (type: string): number =>
      Number(parts.find((part) => part.type === type)?.value ?? 0);

    // Local midnight expressed as though it were UTC. Not yet a real instant.
    const localMidnightAsUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
    );

    // First pass using the offset at that nominal instant...
    const firstGuess =
      localMidnightAsUtc - offsetAt(new Date(localMidnightAsUtc), timeZone);
    // ...then again with the offset that actually applies there, which is what
    // corrects a day whose offset changed partway through.
    return new Date(
      localMidnightAsUtc - offsetAt(new Date(firstGuess), timeZone),
    );
  } catch {
    const fallback = new Date(now);
    fallback.setHours(0, 0, 0, 0);
    return fallback;
  }
}

/**
 * Postgres returns NUMERIC as a STRING, because it does not fit a JS number
 * safely in general. Rounded to kobo so a float artefact never reaches an API
 * response as ₦1234.5600000000001.
 *
 * Exported for the unit test; null/undefined/NaN all become 0, since a missing
 * aggregate means "nothing matched", not "unknown".
 */
export function money(value: string | number | null | undefined): number {
  const parsed = typeof value === 'string' ? Number(value) : (value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

/**
 * Round down to a public-facing milestone.
 *
 * `1,247` on a marketing page is an exact business metric anyone can poll
 * daily to derive a growth curve. `1,000+` says the same thing to a visitor
 * and nothing to a competitor. Small numbers pass through unchanged, because
 * rounding 7 down to 0 would be a lie in the other direction.
 *
 * Exported for the unit test.
 */
export function roundDownToMilestone(value: number): number {
  if (value < 100) return value;
  if (value < 1_000) return Math.floor(value / 100) * 100;
  if (value < 10_000) return Math.floor(value / 1_000) * 1_000;
  return Math.floor(value / 10_000) * 10_000;
}

/** A percentage to one decimal place, and 0 rather than NaN for an empty set. */
export function ratio(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}
