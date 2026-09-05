import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `users.role`.
 *
 * Superseded by BaselineSchema1700000000000, which creates the column as part
 * of the full `users` table. Kept, and made a no-op, for two reasons: a
 * database where this migration DID run must not see it re-applied, and a
 * database where it did not must not see it fail. Deleting the file would also
 * make the history claim `role` was always there, which is not true.
 *
 * Two bugs are fixed rather than preserved:
 *
 *  - It created a type called `user_role_enum` and then used
 *    `addColumn({ type: 'enum', enum: [...] })`, which makes TypeORM generate
 *    its OWN type named `users_role_enum`. The hand-made one was orphaned
 *    immediately, and `down()` dropped the orphan while leaving the real type
 *    behind.
 *  - Neither statement was guarded, so a re-run failed on the duplicate type.
 */
export class AddRoleToUsers1704067200001 implements MigrationInterface {
  name = 'AddRoleToUsers1704067200001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "users_role_enum" AS ENUM('user', 'driver', 'admin');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "role" "users_role_enum" NOT NULL DEFAULT 'user'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "role"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "users_role_enum"`);
    // The orphaned type the original version created, if it is still around.
    await queryRunner.query(`DROP TYPE IF EXISTS "user_role_enum"`);
  }
}
