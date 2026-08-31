import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddRoleToDrivers1704067200002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "driver_role_enum" AS ENUM('user', 'admin', 'driver')`
    );

    await queryRunner.addColumn(
      'drivers',
      new TableColumn({
        name: 'role',
        type: 'enum',
        enum: ['user', 'admin', 'driver'],
        default: "'driver'",
        isNullable: false,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('drivers', 'role');
    await queryRunner.query(`DROP TYPE "driver_role_enum"`);
  }
}
