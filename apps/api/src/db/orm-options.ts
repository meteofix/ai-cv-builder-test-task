import { Migrator } from '@mikro-orm/migrations';
import { defineConfig } from '@mikro-orm/postgresql';
import type { AppConfig } from '../config/env.js';
import { ENTITIES } from './entities.js';

export function ormOptions(config: AppConfig) {
  return defineConfig({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    dbName: config.DB_NAME,
    entities: ENTITIES,
    discovery: { warnWhenNoEntities: false },
    // `ensureDatabase()` in ensure-database.ts is the only place that creates a database.
    ensureDatabase: false,
    extensions: [Migrator],
    migrations: { path: 'dist/db/migrations', pathTs: 'src/db/migrations' },
    // The app logs through pino; MikroORM stays quiet so SQL parameters never reach the logs.
    debug: false,
  });
}
