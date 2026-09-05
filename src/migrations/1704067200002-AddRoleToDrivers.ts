import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `drivers.role`. See AddRoleToUsers1704067200001 for why this is now a
 * guarded no-op and which two bugs were fixed on the way; this file had the
 * identical pair (`driver_role_enum` orphaned in favour of TypeORM's
 * `drivers_role_enum`, and no re-run guard).
 */
export class AddRoleToDrivers1704067200002 implements MigrationInterface {
  name = 'AddRoleToDrivers1704067200002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "drivers_role_enum" AS ENUM('user', 'driver', 'admin');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "drivers"
      ADD COLUMN IF NOT EXISTS "role" "drivers_role_enum" NOT NULL DEFAULT 'driver'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "role"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "drivers_role_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "driver_role_enum"`);
  }
}
