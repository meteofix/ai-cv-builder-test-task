import { LockMode } from '@mikro-orm/core';
import { MikroORM } from '@mikro-orm/postgresql';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  cvDetailSchema,
  cvListResponseSchema,
  problemSchema,
  ROUTES,
  routePath,
  type CvDocument,
} from '@cv/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OwnedCvs } from '../src/common/owned-cvs.js';
import { Cv } from '../src/db/entities.js';
import { createTestApp, inject } from './support/create-test-app.js';
import { entityManager, resetDatabase } from './support/db.js';
import {
  createCv,
  createJob,
  createQuestion,
  SAMPLE_SOURCE_TEXT,
  sampleDocument,
} from './support/factories.js';
import { signIn, type TestSession } from './support/session.js';

/** Behaviour of docs/specs/cvs.md beyond the acceptance examples. */

describe('cvs', () => {
  let app: NestFastifyApplication;
  let session: TestSession;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    session = await signIn(entityManager(app));
  });

  const send = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) =>
    inject(app, {
      method,
      url,
      headers: {
        ...session.headers,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
  const putDocument = (id: string, document: unknown, version: number) =>
    send('PUT', routePath(ROUTES.updateDocument.path, { id }), { document, version });

  it('lists its routes in Swagger, the upload as multipart', async () => {
    const res = await inject(app, { method: 'GET', url: '/api/docs-json' });
    interface Operation {
      requestBody?: { content: Record<string, unknown> };
    }
    const { paths } = res.json<{ paths: Record<string, Record<string, Operation>> }>();
    const routes = [
      ROUTES.listCvs,
      ROUTES.createCvFromText,
      ROUTES.createCvFromPdf,
      ROUTES.getCv,
      ROUTES.updateDocument,
      ROUTES.deleteCv,
    ];
    for (const route of routes) {
      const swaggerPath = route.path.replace(/:(\w+)/g, '{$1}');
      expect(paths[swaggerPath]?.[route.method.toLowerCase()], route.path).toBeDefined();
    }
    const upload = paths[ROUTES.createCvFromPdf.path]?.post?.requestBody;
    expect(Object.keys(upload?.content ?? {})).toEqual(['multipart/form-data']);
  });

  describe('creating from text', () => {
    it.each([
      ['an empty role', { targetRole: '', text: SAMPLE_SOURCE_TEXT }, 'targetRole'],
      ['a blank role', { targetRole: '   ', text: SAMPLE_SOURCE_TEXT }, 'targetRole'],
      ['a role over 200 characters', { targetRole: 'x'.repeat(201), text: 'CV' }, 'targetRole'],
      ['blank text', { targetRole: 'Engineer', text: '  \n ' }, 'text'],
      ['text over 50 000 characters', { targetRole: 'Engineer', text: 'x'.repeat(50_001) }, 'text'],
      ['no text', { targetRole: 'Engineer' }, 'text'],
      ['a NUL character in the text', { targetRole: 'Engineer', text: 'a\u0000b' }, 'text'],
      ['a NUL character in the role', { targetRole: 'En\u0000g', text: 'CV' }, 'targetRole'],
    ])('refuses %s and creates nothing', async (_case, body, path) => {
      const res = await send('POST', ROUTES.createCvFromText.path, body);
      expect(res.statusCode).toBe(400);
      const problem = problemSchema.parse(res.json());
      expect(problem.code).toBe('VALIDATION_FAILED');
      expect(problem.errors?.map((error) => error.path)).toContain(path);
      expect(await entityManager(app).count(Cv)).toBe(0);
    });

    it('trims the role before storing it', async () => {
      const res = await send('POST', ROUTES.createCvFromText.path, {
        targetRole: '  Data Engineer ',
        text: 'CV text',
      });
      expect(res.statusCode).toBe(202);
      const { cvId } = res.json<{ cvId: string }>();
      expect((await entityManager(app).findOneOrFail(Cv, cvId)).targetRole).toBe('Data Engineer');
    });
  });

  describe('listing', () => {
    it('takes the state from the newest job of each CV', async () => {
      const em = entityManager(app);
      const retried = await createCv(em, { user: session.user, document: sampleDocument() });
      await createJob(em, {
        cv: retried,
        status: 'failed',
        createdAt: new Date(Date.now() - 60_000),
      });
      await createJob(em, { cv: retried, status: 'succeeded' });
      const answered = await createCv(em, { user: session.user, document: sampleDocument() });
      await createJob(em, {
        cv: answered,
        status: 'succeeded',
        createdAt: new Date(Date.now() - 60_000),
      });
      await createJob(em, { cv: answered, kind: 'apply_answer', status: 'running' });

      const { items } = cvListResponseSchema.parse((await send('GET', ROUTES.listCvs.path)).json());
      expect(Object.fromEntries(items.map((item) => [item.id, item.state]))).toEqual({
        [retried.id]: 'ready',
        [answered.id]: 'updating',
      });
    });

    it('is empty for a user without CVs', async () => {
      const res = await send('GET', ROUTES.listCvs.path);
      expect(cvListResponseSchema.parse(res.json()).items).toEqual([]);
    });

    it('makes the same number of queries for 1 and for 5 CVs', async () => {
      const orm = app.get(MikroORM);
      const queries = vi.spyOn(orm.em.getConnection(), 'execute');
      const countQueries = async () => {
        queries.mockClear();
        const res = await send('GET', ROUTES.listCvs.path);
        expect(res.statusCode).toBe(200);
        return {
          calls: queries.mock.calls.length,
          items: res.json<{ items: unknown[] }>().items.length,
        };
      };

      const em = entityManager(app);
      const first = await createCv(em, { user: session.user, document: sampleDocument() });
      await createJob(em, { cv: first, status: 'succeeded' });
      const one = await countQueries();
      for (let i = 0; i < 4; i++) {
        const cv = await createCv(em, { user: session.user, document: sampleDocument() });
        await createJob(em, { cv, status: 'succeeded' });
        await createQuestion(em, { cv });
      }
      const five = await countQueries();

      queries.mockRestore();
      expect([one.items, five.items]).toEqual([1, 5]);
      expect(one.calls).toBeGreaterThan(0);
      expect(five.calls).toBe(one.calls);
    });
  });

  describe('reading', () => {
    it('returns every question, of any status, oldest first, with the latest job', async () => {
      const em = entityManager(app);
      const cv = await createCv(em, { user: session.user, document: sampleDocument() });
      const old = await createQuestion(em, {
        cv,
        status: 'dismissed',
        createdAt: new Date(Date.now() - 60_000),
      });
      const open = await createQuestion(em, { cv });
      await createJob(em, { cv, status: 'failed', errorCode: 'AI_UNAVAILABLE' });

      const detail = cvDetailSchema.parse(
        (await send('GET', routePath(ROUTES.getCv.path, { id: cv.id }))).json(),
      );
      expect(detail.questions.map((q) => [q.id, q.status])).toEqual([
        [old.id, 'dismissed'],
        [open.id, 'open'],
      ]);
      expect(detail.job).toMatchObject({
        kind: 'generate',
        status: 'failed',
        error: { code: 'AI_UNAVAILABLE' },
      });
    });
  });

  describe('saving a document', () => {
    let cv: Awaited<ReturnType<typeof createCv>>;
    let document: CvDocument;

    beforeEach(async () => {
      document = sampleDocument();
      cv = await createCv(entityManager(app), { user: session.user, document, version: 1 });
    });

    it('lets one of two saves of the same version win and refuses the other', async () => {
      const [a, b] = await Promise.all([
        putDocument(cv.id, { ...document, headline: 'A' }, 1),
        putDocument(cv.id, { ...document, headline: 'B' }, 1),
      ]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
      const stored = await entityManager(app).findOneOrFail(Cv, cv.id);
      expect(stored.version).toBe(2);
    });

    it.each([
      ['an unsupported locale', (d: CvDocument) => ({ ...d, locale: 'fr' })],
      [
        'more than six bullets in a position',
        (d: CvDocument) => ({
          ...d,
          experience: [
            {
              ...d.experience[0]!,
              bullets: Array.from({ length: 7 }, (_, i) => ({
                id: `b${i}`,
                text: 'x',
                factIds: [],
              })),
            },
          ],
        }),
      ],
      [
        'a javascript: link',
        (d: CvDocument) => ({ ...d, contacts: { ...d.contacts, links: ['javascript:alert(1)'] } }),
      ],
    ])('refuses %s with 400 and stores nothing', async (_case, mutate) => {
      const res = await putDocument(cv.id, mutate(document), 1);
      expect(res.statusCode).toBe(400);
      expect(problemSchema.parse(res.json()).code).toBe('VALIDATION_FAILED');
      expect((await entityManager(app).findOneOrFail(Cv, cv.id)).version).toBe(1);
    });

    it('refuses a NUL character in any field with 400, not a 500', async () => {
      const res = await putDocument(cv.id, { ...document, headline: 'Staff\u0000 Engineer' }, 1);
      expect(res.statusCode).toBe(400);
      expect(problemSchema.parse(res.json()).code).toBe('VALIDATION_FAILED');
    });

    it('reads the CV again after taking the lock, so the version another writer just committed is current', async () => {
      // Another writer commits version 2 after this request has loaded the CV and before it has the lock.
      const original = OwnedCvs.prototype.findOwned.bind(app.get(OwnedCvs));
      const spy = vi
        .spyOn(OwnedCvs.prototype, 'findOwned')
        .mockImplementationOnce(async (...args) => {
          const loaded = await original(...args);
          await entityManager(app).nativeUpdate(
            Cv,
            { id: cv.id },
            { version: 2, document: { ...document, headline: 'Written elsewhere' } },
          );
          return loaded;
        });
      try {
        // The client has seen version 2. Without the second read the stale entity would say 1 and refuse it.
        const res = await putDocument(cv.id, { ...document, headline: 'Mine' }, 2);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ version: 3, document: { headline: 'Mine' } });
      } finally {
        spy.mockRestore();
      }
    });

    it('answers 404 when the CV is deleted between the ownership check and the lock', async () => {
      const original = OwnedCvs.prototype.findOwned.bind(app.get(OwnedCvs));
      const spy = vi
        .spyOn(OwnedCvs.prototype, 'findOwned')
        .mockImplementationOnce(async (...args) => {
          const loaded = await original(...args);
          await entityManager(app).nativeDelete(Cv, { id: cv.id });
          return loaded;
        });
      try {
        const res = await putDocument(cv.id, document, 1);
        expect(res.statusCode).toBe(404);
        expect(problemSchema.parse(res.json()).code).toBe('CV_NOT_FOUND');
      } finally {
        spy.mockRestore();
      }
    });

    it('refuses a save when the version is stale after the lock', async () => {
      await entityManager(app).nativeUpdate(Cv, { id: cv.id }, { version: 2 });
      const res = await putDocument(cv.id, { ...document, headline: 'Late' }, 1);
      expect(res.statusCode).toBe(409);
      expect(problemSchema.parse(res.json()).code).toBe('VERSION_CONFLICT');
      const stored = await entityManager(app).findOneOrFail(Cv, cv.id);
      expect(stored.document?.headline).toBe(document.headline);
    });

    it('refuses a save when a job is queued while it waits for the row lock', async () => {
      let saving: ReturnType<typeof putDocument> | undefined;
      // This transaction holds the CV row the way the answer route does while it inserts its job.
      await entityManager(app).transactional(async (tx) => {
        await tx.findOneOrFail(Cv, cv.id, { lockMode: LockMode.PESSIMISTIC_WRITE });
        saving = putDocument(cv.id, { ...document, headline: 'Too late' }, 1);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await createJob(tx, { cv, kind: 'apply_answer', status: 'queued' });
      });
      // Without the lock the save does not wait: its update goes through and this is a 200, not JOB_ACTIVE.

      const res = await saving;
      expect(res?.statusCode).toBe(409);
      expect(problemSchema.parse(res?.json()).code).toBe('JOB_ACTIVE');
      expect((await entityManager(app).findOneOrFail(Cv, cv.id)).version).toBe(1);
    });

    it('saves a document that contains the six characters \\u0000 as text', async () => {
      const text = String.raw`Escapes such as \u0000 are rejected by Postgres.`;
      const res = await putDocument(cv.id, { ...document, headline: text }, 1);
      expect(res.statusCode).toBe(200);
    });

    it('answers JOB_ACTIVE before DOCUMENT_NOT_READY while the first generation runs', async () => {
      const fresh = await createCv(entityManager(app), { user: session.user });
      await createJob(entityManager(app), { cv: fresh, status: 'running' });
      const res = await putDocument(fresh.id, document, 0);
      expect(problemSchema.parse(res.json()).code).toBe('JOB_ACTIVE');
    });
  });

  describe('deleting', () => {
    it('answers 404 for a CV that is already gone', async () => {
      const cv = await createCv(entityManager(app), { user: session.user });
      const url = routePath(ROUTES.deleteCv.path, { id: cv.id });
      expect((await send('DELETE', url)).statusCode).toBe(204);
      const again = await send('DELETE', url);
      expect(again.statusCode).toBe(404);
      expect(problemSchema.parse(again.json()).code).toBe('CV_NOT_FOUND');
    });
  });
});
