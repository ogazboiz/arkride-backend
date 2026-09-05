import { ForbiddenException } from '@nestjs/common';
import {
  canActOnBehalfOf,
  assertOwnership,
  isPartyToRide,
  assertPartyToRide,
  isAdmin,
} from './ownership.util';
import { Role } from '../enums/role.enum';

const rider = { id: 'rider-1', role: Role.USER };
const otherRider = { id: 'rider-2', role: Role.USER };
const driver = { id: 'driver-1', role: Role.DRIVER };
const admin = { id: 'admin-1', role: Role.ADMIN };

describe('ownership', () => {
  describe('canActOnBehalfOf', () => {
    it('lets a principal act on their own row', () => {
      expect(canActOnBehalfOf(rider, 'rider-1')).toBe(true);
    });

    it("refuses another principal's row", () => {
      expect(canActOnBehalfOf(rider, 'rider-2')).toBe(false);
    });

    it('lets an admin act on anyone', () => {
      expect(canActOnBehalfOf(admin, 'rider-1')).toBe(true);
    });

    it('refuses an unauthenticated caller', () => {
      expect(canActOnBehalfOf(undefined, 'rider-1')).toBe(false);
    });

    it('treats an unowned row as protected, not as public', () => {
      // An unassigned ride has driverId === null. Returning true here would
      // make every pending ride readable by every driver on the platform.
      expect(canActOnBehalfOf(driver, null)).toBe(false);
      expect(canActOnBehalfOf(driver, undefined)).toBe(false);
    });

    it('still lets an admin act on an unowned row', () => {
      expect(canActOnBehalfOf(admin, null)).toBe(true);
    });

    it('does not confuse a driver id with a rider id of the same value', () => {
      // users and drivers are separate tables with separate id spaces, so a
      // collision is possible in principle; the role must not be ignored.
      expect(
        canActOnBehalfOf({ id: 'shared', role: Role.DRIVER }, 'shared'),
      ).toBe(true);
    });
  });

  describe('assertOwnership', () => {
    it('is silent for the owner', () => {
      expect(() =>
        assertOwnership(rider, 'rider-1', 'view your own rides'),
      ).not.toThrow();
    });

    it('throws Forbidden for a stranger', () => {
      expect(() =>
        assertOwnership(rider, 'rider-2', 'view your own rides'),
      ).toThrow(ForbiddenException);
    });

    it('phrases the refusal without revealing whether the row exists', () => {
      try {
        assertOwnership(rider, 'rider-2', 'view your own ride history');
      } catch (error) {
        expect((error as ForbiddenException).message).toBe(
          'You can only view your own ride history.',
        );
      }
    });
  });

  describe('isPartyToRide', () => {
    const ride = { userId: 'rider-1', driverId: 'driver-1' };

    it('accepts the rider', () =>
      expect(isPartyToRide(rider, ride)).toBe(true));
    it('accepts the driver', () =>
      expect(isPartyToRide(driver, ride)).toBe(true));
    it('accepts an admin', () => expect(isPartyToRide(admin, ride)).toBe(true));

    it('refuses an unrelated rider', () => {
      expect(isPartyToRide(otherRider, ride)).toBe(false);
    });

    it('refuses a driver who is not assigned to it', () => {
      expect(isPartyToRide({ id: 'driver-9', role: Role.DRIVER }, ride)).toBe(
        false,
      );
    });

    it('refuses everyone on an unassigned ride except the rider and admins', () => {
      const unassigned = { userId: 'rider-1', driverId: null };
      expect(isPartyToRide(rider, unassigned)).toBe(true);
      expect(isPartyToRide(driver, unassigned)).toBe(false);
      expect(isPartyToRide(admin, unassigned)).toBe(true);
    });

    it('refuses when the ride is missing', () => {
      expect(isPartyToRide(rider, null)).toBe(false);
      expect(isPartyToRide(rider, undefined)).toBe(false);
    });

    it('refuses an unauthenticated caller', () => {
      expect(isPartyToRide(undefined, ride)).toBe(false);
    });
  });

  describe('assertPartyToRide', () => {
    it('throws for a non-party', () => {
      expect(() =>
        assertPartyToRide(
          otherRider,
          { userId: 'rider-1', driverId: 'driver-1' },
          'view SOS incidents',
        ),
      ).toThrow(ForbiddenException);
    });

    it('is silent for a party', () => {
      expect(() =>
        assertPartyToRide(
          rider,
          { userId: 'rider-1', driverId: null },
          'view SOS incidents',
        ),
      ).not.toThrow();
    });
  });

  describe('isAdmin', () => {
    it.each([
      [admin, true],
      [rider, false],
      [driver, false],
      [undefined, false],
    ])('%#', (principal, expected) => {
      expect(isAdmin(principal as any)).toBe(expected);
    });
  });
});
