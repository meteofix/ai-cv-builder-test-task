import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  bulletsOf,
  createCvResponseSchema,
  cvDetailSchema,
  cvListResponseSchema,
  problemSchema,
  ROUTES,
  routePath,
  updateDocumentResponseSchema,
  type CvDocument,
} from '@cv/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Cv, CvQuestion, CvSource, GenerationJob } from '../src/db/entities.js';
import { createTestApp, inject } from './support/create-test-app.js';
import { entityManager, resetDatabase } from './support/db.js';
import {
  createCv,
  createJob,
  createQuestion,
  createUser,
  SAMPLE_SOURCE_TEXT,
  sampleDocument,
} from './support/factories.js';
import { signIn, type TestSession } from './support/session.js';

/** Acceptance examples of docs/specs/cvs.md for creating, listing, reading, editing and deleting CVs. */

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);

describe('cvs acceptance (docs/specs/cvs.md)', () => {
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
  const getCv = (id: string) => send('GET', routePath(ROUTES.getCv.path, { id }));
  const putDocument = (id: string, document: CvDocument, version: number) =>
    send('PUT', routePath(ROUTES.updateDocument.path, { id }), { document, version });

  it('CVS-1 — create from text answers at once', async () => {
    const res = await send('POST', ROUTES.createCvFromText.path, {
      targetRole: 'Senior Backend Engineer',
      text: `  ${SAMPLE_SOURCE_TEXT}  `,
    });
    expect(res.statusCode).toBe(202);
    const { cvId, job } = createCvResponseSchema.parse(res.json());
    expect(job).toEqual({ id: job.id, kind: 'generate', status: 'queued', step: null });

    const detail = cvDetailSchema.parse((await getCv(cvId)).json());
    expect(detail).toMatchObject({
      targetRole: 'Senior Backend Engineer',
      document: null,
      version: 0,
      job,
      questions: [],
    });
    const source = await entityManager(app).findOneOrFail(CvSource, { cv: cvId });
    expect(source).toMatchObject({ kind: 'text', text: SAMPLE_SOURCE_TEXT });
  });

  it('CVS-5 — the list shows only the user’s CVs and their state', async () => {
    const em = entityManager(app);
    const mine = session.user;
    const other = await createUser(em);
    await createCv(em, { user: other, document: sampleDocument() });

    const generating = await createCv(em, { user: mine, updatedAt: hoursAgo(1) });
    await createJob(em, { cv: generating, status: 'running' });
    const failed = await createCv(em, { user: mine, updatedAt: hoursAgo(2) });
    await createJob(em, { cv: failed, status: 'failed', errorCode: 'AI_UNAVAILABLE' });
    const ready = await createCv(em, {
      user: mine,
      updatedAt: hoursAgo(3),
      document: sampleDocument(),
    });
    await createJob(em, { cv: ready, status: 'succeeded', step: 'finalize' });
    await createQuestion(em, { cv: ready });
    await createQuestion(em, { cv: ready });
    await createQuestion(em, { cv: ready, status: 'dismissed' });
    const updating = await createCv(em, {
      user: mine,
      updatedAt: hoursAgo(4),
      document: sampleDocument(),
    });
    await createJob(em, { cv: updating, kind: 'apply_answer', status: 'queued' });

    const res = await send('GET', ROUTES.listCvs.path);
    expect(res.statusCode).toBe(200);
    const { items } = cvListResponseSchema.parse(res.json());
    expect(
      items.map(({ id, state, fullName, openQuestions }) => ({
        id,
        state,
        fullName,
        openQuestions,
      })),
    ).toEqual([
      { id: generating.id, state: 'generating', fullName: null, openQuestions: 0 },
      { id: failed.id, state: 'failed', fullName: null, openQuestions: 0 },
      { id: ready.id, state: 'ready', fullName: 'Iryna Kovalenko', openQuestions: 2 },
      { id: updating.id, state: 'updating', fullName: 'Iryna Kovalenko', openQuestions: 0 },
    ]);
  });

  describe('editing a document', () => {
    let cv: Awaited<ReturnType<typeof createCv>>;
    let document: CvDocument;

    beforeEach(async () => {
      document = sampleDocument();
      cv = await createCv(entityManager(app), {
        user: session.user,
        document,
        version: 1,
        updatedAt: hoursAgo(1),
      });
    });

    it('CVS-6 — saving a document', async () => {
      const before = cvDetailSchema.parse((await getCv(cv.id)).json());
      const edited = { ...document, headline: 'Staff Engineer' };

      const res = await putDocument(cv.id, edited, 1);
      expect(res.statusCode).toBe(200);
      const saved = updateDocumentResponseSchema.parse(res.json());
      expect(saved.document.headline).toBe('Staff Engineer');
      expect(saved.version).toBe(2);

      const after = cvDetailSchema.parse((await getCv(cv.id)).json());
      expect(after.version).toBe(2);
      expect(after.document?.headline).toBe('Staff Engineer');
      expect(Date.parse(after.updatedAt)).toBeGreaterThan(Date.parse(before.updatedAt));
    });

    it('CVS-7 — a stale save does not overwrite', async () => {
      await putDocument(cv.id, { ...document, headline: 'Staff Engineer' }, 1);

      const stale = await putDocument(cv.id, { ...document, headline: 'Overwritten' }, 1);
      expect(stale.statusCode).toBe(409);
      expect(problemSchema.parse(stale.json()).code).toBe('VERSION_CONFLICT');

      const stored = await entityManager(app).findOneOrFail(Cv, cv.id);
      expect(stored.version).toBe(2);
      expect(stored.document?.headline).toBe('Staff Engineer');
    });

    it.each(['queued', 'running'] as const)(
      'CVS-8 — no edits while AI works (%s)',
      async (status) => {
        await createJob(entityManager(app), { cv, kind: 'apply_answer', status });
        const res = await putDocument(cv.id, document, 1);
        expect(res.statusCode).toBe(409);
        expect(problemSchema.parse(res.json()).code).toBe('JOB_ACTIVE');
        expect((await entityManager(app).findOneOrFail(Cv, cv.id)).version).toBe(1);
      },
    );

    it('CVS-10 — manual edits drop provenance', async () => {
      const stored = sampleDocument({
        summary: { text: 'Full-stack engineer.', factIds: ['f1'] },
        experience: [
          {
            id: 'p1',
            factId: 'f2',
            company: 'Acme Corp',
            title: 'Senior Engineer',
            start: '2021',
            end: null,
            current: true,
            groups: [
              {
                id: 'p1-g1',
                title: null,
                items: [
                  {
                    id: 'b1',
                    text: 'Migrated billing to TypeScript.',
                    factIds: ['f3'],
                  },
                  { id: 'b2', text: 'Cut the build time in half.', factIds: ['f4'] },
                ],
              },
            ],
          },
        ],
      });
      const target = await createCv(entityManager(app), {
        user: session.user,
        document: stored,
        version: 1,
      });
      const position = stored.experience[0]!;
      const edited: CvDocument = {
        ...stored,
        summary: { text: 'Full-stack engineer with a focus on billing.', factIds: ['f1'] },
        experience: [
          {
            ...position,
            company: 'Acme Corporation',
            groups: [
              {
                id: 'p1-g1',
                title: null,
                items: [
                  {
                    id: 'b1',
                    text: 'Migrated billing to TypeScript, on time.',
                    factIds: ['f3'],
                  },
                  { id: 'b2', text: 'Cut the build time in half.', factIds: [] },
                  { id: 'b3', text: 'Mentored two engineers.', factIds: ['f9'] },
                ],
              },
            ],
          },
        ],
      };

      const res = await putDocument(target.id, edited, 1);
      expect(res.statusCode).toBe(200);
      const { document: result } = updateDocumentResponseSchema.parse(res.json());
      const [p1] = result.experience;
      expect(p1).not.toHaveProperty('factId');
      expect(bulletsOf(p1!).map(({ id, factIds }) => [id, factIds])).toEqual([
        ['b1', []],
        ['b2', ['f4']],
        ['b3', []],
      ]);
      expect(result.summary.factIds).toEqual([]);
      const persisted = (await entityManager(app).findOneOrFail(Cv, target.id)).document;
      expect(persisted).toEqual(result);
    });
  });

  it('CVS-9 — no edits before the first generation', async () => {
    const cv = await createCv(entityManager(app), { user: session.user });
    const res = await putDocument(cv.id, sampleDocument(), 0);
    expect(res.statusCode).toBe(409);
    expect(problemSchema.parse(res.json()).code).toBe('DOCUMENT_NOT_READY');
  });

  it('CVS-11 — delete', async () => {
    const em = entityManager(app);
    const cv = await createCv(em, { user: session.user, document: sampleDocument() });
    await createQuestion(em, { cv });
    await createJob(em, { cv, status: 'succeeded' });

    const res = await send('DELETE', routePath(ROUTES.deleteCv.path, { id: cv.id }));
    expect(res.statusCode).toBe(204);

    const gone = await getCv(cv.id);
    expect(gone.statusCode).toBe(404);
    expect(problemSchema.parse(gone.json()).code).toBe('CV_NOT_FOUND');
    const check = entityManager(app);
    expect(await check.count(CvSource, { cv: cv.id })).toBe(0);
    expect(await check.count(CvQuestion, { cv: cv.id })).toBe(0);
    expect(await check.count(GenerationJob, { cv: cv.id })).toBe(0);
  });

  it('CVS-11 — a CV whose job is running can be deleted too', async () => {
    const em = entityManager(app);
    const cv = await createCv(em, { user: session.user });
    await createJob(em, { cv, status: 'running' });

    const res = await send('DELETE', routePath(ROUTES.deleteCv.path, { id: cv.id }));
    expect(res.statusCode).toBe(204);
    expect(await entityManager(app).count(GenerationJob, { cv: cv.id })).toBe(0);
  });

  it('CVS-15 — the daily limit stops creation without a trace', async () => {
    const limited = await createTestApp({ GENERATIONS_PER_USER_PER_DAY: 1 });
    try {
      const create = () =>
        inject(limited, {
          method: 'POST',
          url: ROUTES.createCvFromText.path,
          headers: { ...session.headers, 'content-type': 'application/json' },
          payload: JSON.stringify({ targetRole: 'Engineer', text: SAMPLE_SOURCE_TEXT }),
        });
      expect((await create()).statusCode).toBe(202);

      const second = await create();
      expect(second.statusCode).toBe(429);
      expect(problemSchema.parse(second.json()).code).toBe('GENERATION_LIMIT_REACHED');
      expect(await entityManager(app).count(Cv, { user: session.user.id })).toBe(1);
    } finally {
      await limited.close();
    }
  });
});
