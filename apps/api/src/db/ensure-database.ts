import { MikroORM } from '@mikro-orm/postgresql';
import type { AppConfig } from '../config/env.js';
import { ormOptions } from './orm-options.js';

/**
 * Creates the database named by `config.DB_NAME` when it does not exist yet and applies pending migrations.
 * The API calls it on startup and the test setup calls it for the test database, so a fresh worktree or a
 * clean machine needs no manual SQL and no separate migration step.
 */
export async function ensureDatabase(config: AppConfig): Promise<void> {
  const orm = await MikroORM.init(ormOptions(config));
  try {
    // The explicit call throws when the server is unreachable; the `ensureDatabase` init option swallows that.
    await orm.schema.ensureDatabase();
    await orm.migrator.up();
  } finally {
    await orm.close(true);
  }
}
