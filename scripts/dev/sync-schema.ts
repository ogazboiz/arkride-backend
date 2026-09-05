/**
 * Build the schema from the entities into a throwaway database.
 *
 * Used to author and verify the baseline migration: `synchronize: true` is the
 * only thing that has ever created most of these tables, so the entities are
 * the de-facto source of truth for what production actually looks like. The
 * baseline migration is derived from the schema this produces, and then
 * checked against it — rather than hand-written and hoped over.
 *
 * Development only. Never imported by the application.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as path from 'path';

const database = process.argv[2] ?? 'arkrides_baseline';

const ds = new DataSource({
  type: 'postgres',
  host: process.env.SYNC_HOST ?? 'localhost',
  port: Number(process.env.SYNC_PORT ?? 55432),
  username: process.env.SYNC_USER ?? 'postgres',
  password: process.env.SYNC_PASSWORD ?? 'postgres',
  database,
  entities: [path.join(__dirname, '../../src/**/*.entity.ts')],
  synchronize: true,
  logging: false,
});

ds.initialize()
  .then(async () => {
    console.log(`Schema synced from entities into "${database}"`);
    await ds.destroy();
  })
  .catch((error: Error) => {
    console.error('FAILED:', error.message);
    process.exit(1);
  });
