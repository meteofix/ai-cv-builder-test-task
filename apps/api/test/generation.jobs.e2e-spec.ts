import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { jobSchema, problemSchema, ROUTES, routePath } from '@cv/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GenerationQueue } from '../src/common/generation-queue.js';
import { GenerationJob, GenerationUsage } from '../src/db/entities.js';
import { createTestApp, inject } from './support/create-test-app.js';
import { entityManager, resetDatabase } from './support/db.js';
import { createCv, createJob } from './support/factories.js';
import { signIn, type TestSession } from './support/session.js';

/** `GET /api/cvs/:id/job` and `POST /api/cvs/:id/job/retry` (docs/specs/generation.md, Contracts). */
describe('job status and retry endpoints', () => {
  let app: NestFastifyApplication;
  let owner: TestSession;

  beforeAll(async () => {
    app = await createTestApp({ GENERATIONS_PER_USER_PER_DAY: 1 });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    owner = await signIn(entityManager(app));
  });

  async function ownCv() {
    return createCv(entityManager(app), { user: owner.user });
  }

  const getJob = (id: string) =>
    inject(app, {
      method: ROUTES.getJob.method,
      url: routePath(ROUTES.getJob.path, { id }),
      headers: owner.headers,
    });
  const retry = (id: string) =>
    inject(app, {
      method: ROUTES.retryJob.method,
      url: routePath(ROUTES.retryJob.path, { id }),
      headers: owner.headers,
    });

  it.each([
    ['queued', { status: 'queued' }, { status: 'queued', step: null }],
    [
      'failed',
      { status: 'failed', step: 'write', errorCode: 'AI_UNAVAILABLE' },
      { status: 'failed', step: 'write', error: { code: 'AI_UNAVAILABLE' } },
    ],
  ] as const)(
    'GET /job returns the latest job as the queue maps it (%s)',
    async (_case, fields, expected) => {
      const cv = await ownCv();
      const earlier = new Date(Date.now() - 60_000);
      await createJob(entityManager(app), { cv, status: 'succeeded', createdAt: earlier });
      await createJob(entityManager(app), { cv, ...fields });

      const res = await getJob(cv.id);
      expect(res.statusCode).toBe(ROUTES.getJob.status);
      const body = jobSchema.parse(res.json());
      expect(body).toMatchObject(expected);
      expect(body).toEqual(await app.get(GenerationQueue).getLatestJob(cv.id));
    },
  );

  it('GET /job answers 404 NOT_FOUND for a CV without a job', async () => {
    const res = await getJob((await ownCv()).id);
    expect(res.statusCode).toBe(404);
    expect(problemSchema.parse(res.json()).code).toBe('NOT_FOUND');
  });

  it('POST /job/retry continues the failed job: 202, same id, queued, quota charged', async () => {
    const cv = await ownCv();
    const failed = await createJob(entityManager(app), {
      cv,
      status: 'failed',
      step: 'write',
      attempts: 3,
      errorCode: 'AI_UNAVAILABLE',
    });
    const res = await retry(cv.id);
    expect(res.statusCode).toBe(202);
    expect(jobSchema.parse(res.json())).toEqual({
      id: failed.id,
      kind: 'generate',
      status: 'queued',
      step: 'write',
    });
    expect(await entityManager(app).count(GenerationUsage, { user: owner.user.id })).toBe(1);
  });

  it.each([
    ['a running job', 'running', 409, 'JOB_ACTIVE'],
    ['a succeeded job', 'succeeded', 409, 'JOB_NOT_RETRYABLE'],
  ] as const)('POST /job/retry refuses %s', async (_case, status, code, problem) => {
    const cv = await ownCv();
    await createJob(entityManager(app), { cv, status });
    const res = await retry(cv.id);
    expect(res.statusCode).toBe(code);
    expect(problemSchema.parse(res.json()).code).toBe(problem);
  });

  it('POST /job/retry counts against the daily limit: 429 GENERATION_LIMIT_REACHED', async () => {
    const em = entityManager(app);
    em.create(GenerationUsage, { user: owner.user });
    await em.flush();
    const cv = await ownCv();
    const failed = await createJob(entityManager(app), { cv, status: 'failed' });

    const res = await retry(cv.id);
    expect(res.statusCode).toBe(429);
    expect(problemSchema.parse(res.json()).code).toBe('GENERATION_LIMIT_REACHED');
    expect((await entityManager(app).findOneOrFail(GenerationJob, failed.id)).status).toBe(
      'failed',
    );
  });
});
