import { PostgresConnectionOptions } from "typeorm/driver/postgres/PostgresConnectionOptions";
import * as dotenv from 'dotenv';

dotenv.config(); 

const ormconfig: PostgresConnectionOptions = {
  type: 'postgres',
  // If DATABASE_URL exists (production/Neon), use it. Otherwise use individual credentials (local)
  ...(process.env.DATABASE_URL 
    ? { 
        url: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      } 
    : {
        host: process.env.DATABASE_HOST,
        port: parseInt(process.env.DATABASE_PORT || '5432', 10),
        username: process.env.DATABASE_USERNAME,
        password: process.env.DATABASE_PASSWORD,
        database: process.env.DATABASE_NAME,
        ssl: false
      }
  ),
  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  migrationsRun: false,
  synchronize: process.env.NODE_ENV === 'development',
}

export default ormconfig;