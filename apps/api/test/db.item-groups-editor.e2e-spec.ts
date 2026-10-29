import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { cvDetailSchema, routePath, ROUTES, type CvDocument } from '@cv/shared';
import { MikroORM } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { Migration20261029140000_item_groups } from '../src/db/migrations/Migration20261029140000_item_groups.js';
import { createTestApp, inject } from './support/create-test-app.js';
import { entityManager, resetDatabase } from './support/db.js';
import { createCv, sampleDocument } from './support/factories.js';
import { signIn } from './support/session.js';

let app: NestFastifyApplication;

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDatabase(app);
});

/** A document as it was stored before the item groups: flat bullets, an extra section as one list. */
function savedBeforeGroups(document: CvDocument, lines: number) {
  return {
    ...document,
    experience: document.experience.map(({ groups, ...job }) => ({
      ...job,
      bullets: groups.flatMap((group) => group.items),
    })),
    additional: [
      {
        id: 'a1',
        title: 'Talks',
        items: Array.from({ length: lines }, (_, i) => ({
          id: `l${i}`,
          text: `Talk ${i}`,
          factIds: [],
        })),
      },
    ],
  };
}

it('opens and saves from the editor a CV saved before the migration with a 26-line section', async () => {
  const em = entityManager(app);
  const session = await signIn(em);
  const cv = await createCv(em, { user: session.user, document: sampleDocument() });
  await em.execute(`update cvs set document = ?::jsonb where id = ?`, [
    JSON.stringify(savedBeforeGroups(sampleDocument(), 26)),
    cv.id,
  ]);
  const orm = app.get(MikroORM);
  const step = new Migration20261029140000_item_groups(orm.em.getDriver(), orm.config);
  await step.up();
  for (const query of step.getQueries()) await entityManager(app).execute(query);

  const send = (method: 'GET' | 'PUT', body?: unknown) =>
    inject(app, {
      method,
      url: routePath((method === 'GET' ? ROUTES.getCv : ROUTES.updateDocument).path, {
        id: cv.id,
      }),
      headers: {
        ...session.headers,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
  const opened = cvDetailSchema.parse((await send('GET')).json());
  const document = opened.document;
  if (!document) throw new Error('the migrated CV has no document');
  expect(document.additional[0]?.entries.map((entry) => entry.groups[0]?.items.length)).toEqual([
    20, 6,
  ]);

  const saved = await send('PUT', {
    document: { ...document, headline: 'Staff Engineer' },
    version: opened.version,
  });
  expect(saved.statusCode).toBe(200);
  const reopened = cvDetailSchema.parse((await send('GET')).json());
  expect(reopened.document).toEqual({ ...document, headline: 'Staff Engineer' });
  expect(reopened.version).toBe(opened.version + 1);
});
