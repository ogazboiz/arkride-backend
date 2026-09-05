import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The SOS incident log.
 *
 * ON DELETE CASCADE on rideId matches the rest of the schema, though in
 * practice rides are not deleted — an incident record outliving the app process
 * that created it is the whole point of writing it before notifying anyone.
 *
 * NOW GUARDED. BaselineSchema1700000000000 creates this too, so every
 * statement below has to tolerate already being satisfied — an unguarded
 * CREATE would abort the whole migration run on a fresh database.
 */
export class CreateEmergencyIncidents1756600000004
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {

    // The baseline created this table with TypeORM's own enum type names
    // (plural: `emergency_incidents_*_enum`). Creating this migration's original
    // singular-named types as well would leave orphans behind — types nothing
    // references, which then show up as noise in a future
    // `migration:generate`. So the original body only runs if the baseline did
    // NOT already do the work, which today means: never on a fresh database,
    // and never on one synchronize built either.
    const alreadyBuilt = await queryRunner.hasTable('emergency_incidents');
    if (alreadyBuilt) return;
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "emergency_triggered_by_enum" AS ENUM('rider', 'driver');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "emergency_status_enum" AS ENUM('active', 'resolved', 'false_alarm');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "emergency_incidents" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "rideId" uuid NOT NULL,
        "triggeredBy" "emergency_triggered_by_enum" NOT NULL,
        "triggeredById" uuid NOT NULL,
        "location" jsonb,
        "note" text,
        "status" "emergency_status_enum" NOT NULL DEFAULT 'active',
        "resolutionNote" text,
        "resolvedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_emergency_incidents" PRIMARY KEY ("id"),
        CONSTRAINT "FK_emergency_incidents_ride" FOREIGN KEY ("rideId")
          REFERENCES "rides"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_emergency_ride" ON "emergency_incidents" ("rideId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_emergency_status" ON "emergency_incidents" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_emergency_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_emergency_ride"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "emergency_incidents"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "emergency_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "emergency_triggered_by_enum"`);
  }
}
