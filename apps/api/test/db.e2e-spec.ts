import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Cv, CvQuestion, CvSource, GenerationJob } from '../src/db/entities.js';
import { createTestApp } from './support/create-test-app.js';
import { entityManager, resetDatabase } from './support/db.js';
import { createCv, createJob, createQuestion, createUser } from './support/factories.js';

describe('database schema', () => {
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

  it('deletes the source, questions and jobs of a deleted CV (the worker relies on it)', async () => {
    const em = entityManager(app);
    const cv = await createCv(em, { user: await createUser(em) });
    await createQuestion(em, { cv });
    await createJob(em, { cv, status: 'running' });

    await em.nativeDelete(Cv, { id: cv.id });

    const fresh = entityManager(app);
    expect(await fresh.count(CvSource, { cv: cv.id })).toBe(0);
    expect(await fresh.count(CvQuestion, { cv: cv.id })).toBe(0);
    expect(await fresh.count(GenerationJob, { cv: cv.id })).toBe(0);
  });

  it.each([['queued'], ['running']] as const)(
    'refuses a second active job for one CV while one is %s',
    async (status) => {
      const em = entityManager(app);
      const cv = await createCv(em, { user: await createUser(em) });
      await createJob(em, { cv, status });
      await expect(createJob(entityManager(app), { cv, status: 'queued' })).rejects.toThrow(
        /generation_jobs_one_active_per_cv/,
      );
    },
  );

  it('allows a new job once the previous one has finished', async () => {
    const em = entityManager(app);
    const cv = await createCv(em, { user: await createUser(em) });
    await createJob(em, { cv, status: 'succeeded' });
    await createJob(em, { cv, status: 'failed' });
    await expect(createJob(em, { cv, status: 'queued' })).resolves.toBeDefined();
  });
});
