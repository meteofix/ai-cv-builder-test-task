import { MikroORM, type EntityManager } from '@mikro-orm/postgresql';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/** A fresh EntityManager on the app's connection, for factories and assertions outside a request. */
export function entityManager(app: NestFastifyApplication): EntityManager {
  return app.get(MikroORM).em.fork();
}

/** Empties every table of the schema; call it in `beforeEach` so tests do not see each other's rows. */
export async function resetDatabase(app: NestFastifyApplication): Promise<void> {
  const orm = app.get(MikroORM);
  const names = [...orm.getMetadata()].map((meta) => `"${meta.tableName}"`);
  await orm.em.getConnection().execute(`truncate table ${names.join(', ')} cascade`);
}
