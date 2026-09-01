import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The SOS incident log.
 *
 * ON DELETE CASCADE on rideId matches the rest of the schema, though in
 * practice rides are not deleted — an incident record outliving the app process
 * that created it is the whole point of writing it before notifying anyone.
 */
export class CreateEmergencyIncidents1756600000004
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "emergency_triggered_by_enum" AS ENUM('rider', 'driver')
    `);

    await queryRunner.query(`
      CREATE TYPE "emergency_status_enum" AS ENUM('active', 'resolved', 'false_alarm')
    `);

    await queryRunner.query(`
      CREATE TABLE "emergency_incidents" (
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
      CREATE INDEX "idx_emergency_ride" ON "emergency_incidents" ("rideId")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_emergency_status" ON "emergency_incidents" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_emergency_status"`);
    await queryRunner.query(`DROP INDEX "idx_emergency_ride"`);
    await queryRunner.query(`DROP TABLE "emergency_incidents"`);
    await queryRunner.query(`DROP TYPE "emergency_status_enum"`);
    await queryRunner.query(`DROP TYPE "emergency_triggered_by_enum"`);
  }
}
