import { windows, startOfDayIn, money, ratio } from './stats.service';

/**
 * The SQL in StatsService is verified end-to-end against a real Postgres by
 * `scripts/dev/verify-stats.ts` — a mocked repository cannot tell you whether
 * `EXTRACT`, a jsonb `->>` or an interval subtraction actually works.
 *
 * What IS worth unit-testing is the pure logic around those queries, because
 * each piece here encodes a bug that was found rather than imagined.
 */
describe('stats helpers', () => {
  describe('windows', () => {
    it('computes boundaries from the instant it is given, not from module load', () => {
      // The bug this guards: hoisting `const now = new Date()` to module scope
      // freezes "today" at process start, so a long-running container drifts
      // further from the truth every day it stays up — and always looks
      // correct in testing, because a fresh process is right.
      const first = windows(new Date('2026-03-01T12:00:00Z'));
      const second = windows(new Date('2026-06-01T12:00:00Z'));
      expect(first.startOfToday.getTime()).not.toBe(second.startOfToday.getTime());
    });

    it('puts the seven-day window seven days back', () => {
      const { now, sevenDaysAgo } = windows(new Date('2026-03-15T12:00:00Z'));
      const days = (now.getTime() - sevenDaysAgo.getTime()) / 86_400_000;
      expect(Math.round(days)).toBe(7);
    });

    it('puts the thirty-day window thirty days back', () => {
      const { now, thirtyDaysAgo } = windows(new Date('2026-03-15T12:00:00Z'));
      const days = (now.getTime() - thirtyDaysAgo.getTime()) / 86_400_000;
      expect(Math.round(days)).toBe(30);
    });

    it('crosses a month boundary correctly', () => {
      const { sevenDaysAgo } = windows(new Date('2026-03-03T12:00:00Z'));
      expect(sevenDaysAgo.getUTCMonth()).toBe(1); // February
    });
  });

  describe('startOfDayIn', () => {
    it('uses the reporting timezone, not the server one', () => {
      // 00:30 in Lagos (UTC+1) is 23:30 UTC the PREVIOUS day. A server-local
      // midnight would call this "yesterday" and under-report today's rides
      // for the first hour of every morning.
      const at0030Lagos = new Date('2026-03-15T23:30:00Z');
      const start = startOfDayIn(at0030Lagos, 'Africa/Lagos');
      // Lagos midnight on the 16th == 23:00 UTC on the 15th.
      expect(start.toISOString()).toBe('2026-03-15T23:00:00.000Z');
    });

    it('is exactly midnight, to the millisecond', () => {
      const start = startOfDayIn(new Date('2026-03-15T14:37:52.431Z'), 'Africa/Lagos');
      expect(start.toISOString()).toBe('2026-03-14T23:00:00.000Z');
    });

    it('never returns an instant in the future', () => {
      for (const iso of [
        '2026-03-15T00:00:00Z',
        '2026-03-15T23:59:59Z',
        '2026-01-01T12:00:00Z',
        '2026-06-30T04:15:00Z',
      ]) {
        const now = new Date(iso);
        expect(startOfDayIn(now, 'Africa/Lagos').getTime()).toBeLessThanOrEqual(
          now.getTime(),
        );
      }
    });

    it('is never more than 24 hours back', () => {
      for (const iso of ['2026-03-15T00:30:00Z', '2026-11-02T05:00:00Z']) {
        const now = new Date(iso);
        const delta = now.getTime() - startOfDayIn(now, 'Africa/Lagos').getTime();
        expect(delta).toBeLessThan(24 * 3600_000);
        expect(delta).toBeGreaterThanOrEqual(0);
      }
    });

    it('handles a zone with a non-hour offset', () => {
      // Kolkata is UTC+5:30 — an offset that a naive hour-based calculation
      // gets wrong by thirty minutes.
      const start = startOfDayIn(new Date('2026-03-15T12:00:00Z'), 'Asia/Kolkata');
      expect(start.toISOString()).toBe('2026-03-14T18:30:00.000Z');
    });

    it('handles a spring-forward DST transition day', () => {
      // 2026-03-08 is the US spring-forward. The offset changes mid-day, so a
      // fixed offset would be an hour out after 02:00 local.
      // Midnight on 2026-03-08 in New York is still EST (UTC-5), so it is
      // 05:00Z — even though by 18:00Z the zone has moved to EDT (UTC-4).
      // The naive "now minus wall-clock elapsed" version returns 04:00Z here.
      const now = new Date('2026-03-08T18:00:00Z'); // 14:00 EDT
      const start = startOfDayIn(now, 'America/New_York');
      expect(start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    });

    it('falls back to server midnight for an invalid timezone', () => {
      // A typo in REPORTING_TIMEZONE must not 500 every stats request.
      const now = new Date('2026-03-15T12:00:00Z');
      expect(() => startOfDayIn(now, 'Not/AZone')).not.toThrow();
      const start = startOfDayIn(now, 'Not/AZone');
      expect(start.getHours()).toBe(0);
    });

    it('handles an autumn fall-back DST transition day', () => {
      // 2026-11-01, EDT -> EST. Midnight is still EDT (UTC-4) = 04:00Z, and
      // the day is 25 hours long.
      const now = new Date('2026-11-01T20:00:00Z'); // 15:00 EST
      expect(startOfDayIn(now, 'America/New_York').toISOString()).toBe(
        '2026-11-01T04:00:00.000Z',
      );
    });

    it('handles UTC itself', () => {
      const start = startOfDayIn(new Date('2026-03-15T13:45:00Z'), 'UTC');
      expect(start.toISOString()).toBe('2026-03-15T00:00:00.000Z');
    });
  });

  describe('money', () => {
    it('parses the STRING Postgres returns for NUMERIC', () => {
      // node-postgres hands back NUMERIC as a string because it does not fit a
      // JS number in general. Forgetting that turns SUM into concatenation.
      expect(money('1234.56')).toBe(1234.56);
    });

    it('rounds to kobo so float noise never reaches a response', () => {
      expect(money(1234.560000000001)).toBe(1234.56);
      expect(money('0.1')).toBe(0.1);
    });

    it.each([null, undefined, '', 'not a number', NaN, Infinity])(
      'returns 0 for %p — a missing aggregate means nothing matched',
      (value) => {
        expect(money(value as any)).toBe(0);
      },
    );

    it('keeps negatives signed — withdrawals are negative in the ledger', () => {
      expect(money('-500.00')).toBe(-500);
    });

    it('handles zero', () => {
      expect(money('0')).toBe(0);
      expect(money(0)).toBe(0);
    });
  });

  describe('ratio', () => {
    it('returns a percentage to one decimal place', () => {
      expect(ratio(1, 3)).toBe(33.3);
      expect(ratio(1, 2)).toBe(50);
    });

    it('returns 0 rather than NaN for an empty set', () => {
      // A brand-new deployment has no rides; the dashboard must not show NaN%.
      expect(ratio(0, 0)).toBe(0);
      expect(ratio(5, 0)).toBe(0);
    });

    it('handles the whole being the part', () => {
      expect(ratio(7, 7)).toBe(100);
    });
  });
});

describe('roundDownToMilestone', () => {
  const { roundDownToMilestone } = require('./stats.service');

  it('leaves small numbers alone — rounding 7 to 0 would be its own lie', () => {
    expect(roundDownToMilestone(0)).toBe(0);
    expect(roundDownToMilestone(7)).toBe(7);
    expect(roundDownToMilestone(99)).toBe(99);
  });

  it('rounds hundreds down to the hundred', () => {
    expect(roundDownToMilestone(247)).toBe(200);
    expect(roundDownToMilestone(999)).toBe(900);
  });

  it('rounds thousands down to the thousand', () => {
    // The point: 1,247 is a pollable business metric; 1,000 is a marketing
    // number that gives a competitor no growth curve.
    expect(roundDownToMilestone(1247)).toBe(1000);
    expect(roundDownToMilestone(9999)).toBe(9000);
  });

  it('rounds larger numbers down to ten thousands', () => {
    expect(roundDownToMilestone(41_872)).toBe(40_000);
    expect(roundDownToMilestone(1_234_567)).toBe(1_230_000);
  });

  it('never rounds UP — the figure must stay defensible', () => {
    for (const n of [99, 100, 101, 999, 1000, 1001, 9999, 10_000, 12_345]) {
      expect(roundDownToMilestone(n)).toBeLessThanOrEqual(n);
    }
  });
});
