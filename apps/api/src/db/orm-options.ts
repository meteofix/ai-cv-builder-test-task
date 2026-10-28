import { Migrator } from '@mikro-orm/migrations';
import { defineConfig } from '@mikro-orm/postgresql';
import type { AppConfig } from '../config/env.js';
import { ENTITIES } from './entities.js';
import { MIGRATIONS } from './migrations/index.js';

export function ormOptions(config: AppConfig) {
  return defineConfig({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    dbName: config.DB_NAME,
    entities: ENTITIES,
    // `ensureDatabase()` in ensure-database.ts is the only place that creates a database.
    ensureDatabase: false,
    extensions: [Migrator],
    // A new migration is generated into `pathTs` against a migrated database and added to MIGRATIONS.
    migrations: { migrationsList: MIGRATIONS, pathTs: 'src/db/migrations', snapshot: false },
    // The app logs through pino; MikroORM stays quiet so SQL parameters never reach the logs.
    debug: false,
  });
}
