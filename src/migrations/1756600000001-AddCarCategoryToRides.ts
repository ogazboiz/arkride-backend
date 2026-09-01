import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds 'car' to the rides.category enum.
 *
 * Why this is hand-written rather than generated:
 * No migration ever created the `rides` table — it was produced by
 * `synchronize: true` in development, so the actual Postgres enum type name
 * backing rides.category is whatever TypeORM's naming strategy produced at the
 * time, and it may differ between environments. On top of that,
 * `migration:generate` will happily emit a DROP + recreate of the enum type
 * (via a temp column and a USING cast) instead of an ADD VALUE, which is
 * destructive and lock-heavy on a populated table.
 *
 * So we look the real type name up from the catalog at migration time and
 * ALTER it in place. Requires Postgres 12+ (compose runs postgres:16), where
 * ALTER TYPE ... ADD VALUE is permitted inside a transaction block as long as
 * the new value is not used in that same transaction — which it is not here.
 *
 * To see the name yourself:
 *   SELECT udt_name FROM information_schema.columns
 *   WHERE table_name = 'rides' AND column_name = 'category';
 */
export class AddCarCategoryToRides1756600000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE
        enum_type_name text;
      BEGIN
        SELECT udt_name INTO enum_type_name
        FROM information_schema.columns
        WHERE table_name = 'rides' AND column_name = 'category';

        IF enum_type_name IS NULL THEN
          RAISE EXCEPTION 'Could not resolve the enum type behind rides.category — does the rides table exist?';
        END IF;

        EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L', enum_type_name, 'car');
      END
      $$;
    `);
  }

  public async down(): Promise<void> {
    // Postgres has no DROP VALUE for enums. Removing 'car' would mean rebuilding
    // the type and rewriting every dependent column, which would fail anyway for
    // any ride already booked as a car. Intentionally irreversible.
  }
}
