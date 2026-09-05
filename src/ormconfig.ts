import { PostgresConnectionOptions } from "typeorm/driver/postgres/PostgresConnectionOptions";
import * as dotenv from 'dotenv';

dotenv.config(); 

const isSsl = process.env.DATABASE_SSL === 'true';

const ormconfig: PostgresConnectionOptions = {
  type: 'postgres',
  ...(process.env.DATABASE_URL 
    ? { 
        url: process.env.DATABASE_URL,
        ssl: isSsl ? { rejectUnauthorized: false } : false,
      } 
    : {
        host: process.env.DATABASE_HOST || 'postgres',
        port: parseInt(process.env.DATABASE_PORT || '5432', 10),
        username: process.env.DATABASE_USERNAME || 'postgres',
        password: process.env.DATABASE_PASSWORD || 'postgres',
        database: process.env.DATABASE_NAME || 'arkrides',
        ssl: isSsl ? { rejectUnauthorized: false } : false,
      }
  ),
  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  migrationsRun: false,

  /**
   * OFF by default, everywhere — including development.
   *
   * `synchronize: process.env.NODE_ENV === 'development'` is how this schema
   * came to have six tables that no migration creates: it silently reshaped
   * developers' databases from the entities, so nobody ever noticed that the
   * migrations could not build anything. Deployed environments set NODE_ENV to
   * staging/production, so they had synchronize OFF and no working migrations
   * either — the schema was unbuildable anywhere it actually ran.
   *
   * Migrations are now the only way the schema changes. `pnpm migration:run`
   * builds a database from empty, and is verified to produce exactly what the
   * entities describe.
   *
   * DB_SYNCHRONIZE=true is still available as a deliberate local escape hatch
   * for prototyping an entity, and it refuses to engage outside development so
   * that setting it in a deployment env file does nothing.
   */
  synchronize:
    process.env.DB_SYNCHRONIZE === 'true' &&
    process.env.NODE_ENV === 'development',
};

export default ormconfig;