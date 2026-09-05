import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the ledger_entries audit table and the rider cashback balance column.
 *
 * The unique partial index on (rideId, type) is the structural backstop that
 * makes paying out a ride's fare split twice impossible at the database level,
 * regardless of what happens in application code.
 *
 * NOW GUARDED. BaselineSchema1700000000000 creates this table too, so on a
 * fresh database every statement below is already satisfied and an unguarded
 * CREATE would abort the whole migration run.
 *
 * A naming wart worth knowing about: this migration names its enum types
 * `ledger_entry_*` (singular), while TypeORM's naming strategy — and therefore
 * the baseline — produces `ledger_entries_*` (plural). A database built by
 * this migration and one built by the baseline both work and both satisfy the
 * entity, but they are not byte-identical. The types are created here anyway
 * so that a database which took THIS path can still be rolled back by the
 * matching `down()`.
 */
export class CreateLedgerAndCashback1756600000002
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {

    // The baseline created this table with TypeORM's own enum type names
    // (plural: `ledger_entries_*_enum`). Creating this migration's original
    // singular-named types as well would leave orphans behind — types nothing
    // references, which then show up as noise in a future
    // `migration:generate`. So the original body only runs if the baseline did
    // NOT already do the work, which today means: never on a fresh database,
    // and never on one synchronize built either.
    const alreadyBuilt = await queryRunner.hasTable('ledger_entries');
    if (alreadyBuilt) return;
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "ledger_entry_type_enum" AS ENUM(
        'ride_fare_driver',
        'ride_fare_platform',
        'ride_fare_rider_cashback',
        'driver_fuel_support_mfb',
        'driver_payout_linkpay'
      );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "ledger_stakeholder_type_enum" AS ENUM('driver', 'rider', 'platform');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "ledger_entry_status_enum" AS ENUM('pending', 'completed', 'failed', 'reversed');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ledger_entries" (
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
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_ledger_ride_type"
      ON "ledger_entries" ("rideId", "type")
      WHERE "rideId" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_ledger_stakeholder"
      ON "ledger_entries" ("stakeholderType", "stakeholderId")
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "cashbackBalance" numeric(12,2) NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "cashbackBalance"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_ledger_stakeholder"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_ledger_ride_type"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ledger_entries"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "ledger_entry_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "ledger_stakeholder_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "ledger_entry_type_enum"`);
  }
}
