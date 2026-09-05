import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records which entry point produced a booking (app, WhatsApp agent, voice).
 *
 * Brand new enum type and column, so unlike the car category migration this one
 * creates rather than alters — no catalog lookup needed.
 *
 * NOW GUARDED. BaselineSchema1700000000000 creates this too, so every
 * statement below has to tolerate already being satisfied — an unguarded
 * CREATE would abort the whole migration run on a fresh database.
 */
export class AddOriginChannelToRides1756600000003
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {

    // Same reasoning as CreateLedgerAndCashback: the baseline already added
    // this column with TypeORM's `rides_originchannel_enum`, so creating the
    // original `ride_origin_channel_enum` here would only orphan a type.
    const rides = await queryRunner.getTable('rides');
    if (rides?.findColumnByName('originChannel')) return;
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "ride_origin_channel_enum" AS ENUM('app', 'whatsapp', 'voice');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "rides"
      ADD COLUMN IF NOT EXISTS "originChannel" "ride_origin_channel_enum" NOT NULL DEFAULT 'app'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "rides" DROP COLUMN IF EXISTS "originChannel"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "ride_origin_channel_enum"`);
  }
}
