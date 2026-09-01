import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the ledger_entries audit table and the rider cashback balance column.
 *
 * The unique partial index on (rideId, type) is the structural backstop that
 * makes paying out a ride's fare split twice impossible at the database level,
 * regardless of what happens in application code.
 */
export class CreateLedgerAndCashback1756600000002
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "ledger_entry_type_enum" AS ENUM(
        'ride_fare_driver',
        'ride_fare_platform',
        'ride_fare_rider_cashback',
        'driver_fuel_support_mfb',
        'driver_payout_linkpay'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "ledger_stakeholder_type_enum" AS ENUM('driver', 'rider', 'platform')
    `);

    await queryRunner.query(`
      CREATE TYPE "ledger_entry_status_enum" AS ENUM('pending', 'completed', 'failed', 'reversed')
    `);

    await queryRunner.query(`
      CREATE TABLE "ledger_entries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "rideId" uuid,
        "type" "ledger_entry_type_enum" NOT NULL,
        "stakeholderType" "ledger_stakeholder_type_enum" NOT NULL,
        "stakeholderId" uuid,
        "amount" numeric(12,2) NOT NULL,
        "currency" character varying(3) NOT NULL DEFAULT 'NGN',
        "status" "ledger_entry_status_enum" NOT NULL DEFAULT 'completed',
        "providerReference" character varying,
        "metadata" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ledger_entries" PRIMARY KEY ("id")
      )
    `);

    // One entry of each type per ride, ever.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_ledger_ride_type"
      ON "ledger_entries" ("rideId", "type")
      WHERE "rideId" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_ledger_stakeholder"
      ON "ledger_entries" ("stakeholderType", "stakeholderId")
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN "cashbackBalance" numeric(12,2) NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "cashbackBalance"`,
    );
    await queryRunner.query(`DROP INDEX "idx_ledger_stakeholder"`);
    await queryRunner.query(`DROP INDEX "uq_ledger_ride_type"`);
    await queryRunner.query(`DROP TABLE "ledger_entries"`);
    await queryRunner.query(`DROP TYPE "ledger_entry_status_enum"`);
    await queryRunner.query(`DROP TYPE "ledger_stakeholder_type_enum"`);
    await queryRunner.query(`DROP TYPE "ledger_entry_type_enum"`);
  }
}
