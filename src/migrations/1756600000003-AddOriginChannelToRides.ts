import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records which entry point produced a booking (app, WhatsApp agent, voice).
 *
 * Brand new enum type and column, so unlike the car category migration this one
 * creates rather than alters — no catalog lookup needed.
 */
export class AddOriginChannelToRides1756600000003
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "ride_origin_channel_enum" AS ENUM('app', 'whatsapp', 'voice')
    `);

    await queryRunner.query(`
      ALTER TABLE "rides"
      ADD COLUMN "originChannel" "ride_origin_channel_enum" NOT NULL DEFAULT 'app'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "rides" DROP COLUMN "originChannel"`);
    await queryRunner.query(`DROP TYPE "ride_origin_channel_enum"`);
  }
}
