import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../src/common/api-error.js';
import { GenerationQueue } from '../src/common/generation-queue.js';
import { Cv, CvQuestion, GenerationJob, GenerationUsage, type ICv } from '../src/db/entities.js';
import { createTestApp } from './support/create-test-app.js';
import { entityManager, resetDatabase } from './support/db.js';
import { createCv, createJob, createQuestion, createUser } from './support/factories.js';

const LIMITS = { GENERATIONS_PER_USER_PER_DAY: 2, GENERATIONS_TOTAL: 3 };

function rejectsWith(promise: Promise<unknown>, code: string) {
  return expect(promise).rejects.toSatisfy(
    (error) => error instanceof ApiError && error.code === code,
  );
}

describe('GenerationQueue', () => {
  let app: NestFastifyApplication;
  let queue: GenerationQueue;

  beforeAll(async () => {
    app = await createTestApp(LIMITS);
    queue = app.get(GenerationQueue);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
  });

  async function newCv(user?: Awaited<ReturnType<typeof createUser>>): Promise<ICv> {
    const em = entityManager(app);
    return createCv(em, { user: user ?? (await createUser(em)) });
  }

  describe('enqueue', () => {
    it('queues a generate job, charges the quota and reports it as the latest job', async () => {
      const cv = await newCv();
      const job = await queue.enqueue(entityManager(app), cv, { kind: 'generate' });

      expect(job).toEqual({ id: job.id, kind: 'generate', status: 'queued', step: null });
      expect(await queue.getLatestJob(cv.id)).toEqual(job);
      expect(await queue.hasActiveJob(cv.id)).toBe(true);
      expect(await entityManager(app).count(GenerationUsage, { user: cv.user.id })).toBe(1);
    });

    it('refuses a second active job for the same CV with JOB_ACTIVE', async () => {
      const cv = await newCv();
      await queue.enqueue(entityManager(app), cv, { kind: 'generate' });
      await rejectsWith(queue.enqueue(entityManager(app), cv, { kind: 'generate' }), 'JOB_ACTIVE');
    });

    it('lets only one of two parallel requests queue a job for one CV', async () => {
      const cv = await newCv();
      const results = await Promise.allSettled([
        queue.enqueue(entityManager(app), cv, { kind: 'generate' }),
        queue.enqueue(entityManager(app), cv, { kind: 'generate' }),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(await entityManager(app).count(GenerationJob, { cv: cv.id })).toBe(1);
    });

    it('carries the target and payload of an apply_answer job and does not charge the quota', async () => {
      const cv = await newCv();
      const question = await createQuestion(entityManager(app), { cv });
      const target = { questionId: question.id, section: 'experience' as const, itemId: 'p1' };
      const job = await queue.enqueue(entityManager(app), cv, {
        kind: 'apply_answer',
        target,
        payload: {
          questionId: question.id,
          answer: { type: 'dates', start: '2020', end: null, current: true },
        },
      });
      expect(job.target).toEqual(target);
      expect(await entityManager(app).count(GenerationUsage, {})).toBe(0);
    });
  });

  describe('daily limits', () => {
    it('stops a user at GENERATIONS_PER_USER_PER_DAY', async () => {
      const em = entityManager(app);
      const user = await createUser(em);
      for (let i = 0; i < LIMITS.GENERATIONS_PER_USER_PER_DAY; i++) {
        await queue.enqueue(entityManager(app), await newCv(user), { kind: 'generate' });
      }
      await rejectsWith(
        queue.enqueue(entityManager(app), await newCv(user), { kind: 'generate' }),
        'GENERATION_LIMIT_REACHED',
      );
    });

    it('does not give the quota back when a CV is deleted', async () => {
      const user = await createUser(entityManager(app));
      for (let i = 0; i < LIMITS.GENERATIONS_PER_USER_PER_DAY; i++) {
        const cv = await newCv(user);
        await queue.enqueue(entityManager(app), cv, { kind: 'generate' });
        await entityManager(app).nativeDelete(Cv, { id: cv.id });
      }
      await rejectsWith(
        queue.enqueue(entityManager(app), await newCv(user), { kind: 'generate' }),
        'GENERATION_LIMIT_REACHED',
      );
    });

    it('counts only the last 24 hours', async () => {
      const user = await createUser(entityManager(app));
      const em = entityManager(app);
      for (let i = 0; i < LIMITS.GENERATIONS_PER_USER_PER_DAY; i++) {
        em.create(GenerationUsage, { user, createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });
      }
      await em.flush();
      await expect(
        queue.enqueue(entityManager(app), await newCv(user), { kind: 'generate' }),
      ).resolves.toMatchObject({ status: 'queued' });
    });

    it('stops everyone at GENERATIONS_TOTAL', async () => {
      for (let i = 0; i < LIMITS.GENERATIONS_TOTAL; i++) {
        await queue.enqueue(entityManager(app), await newCv(), { kind: 'generate' });
      }
      await rejectsWith(
        queue.enqueue(entityManager(app), await newCv(), { kind: 'generate' }),
        'GENERATION_LIMIT_REACHED',
      );
    });

    it('does not let parallel requests take more than the quota', async () => {
      const user = await createUser(entityManager(app));
      const cvs = await Promise.all([1, 2, 3, 4].map(() => newCv(user)));
      const results = await Promise.allSettled(
        cvs.map((cv) => queue.enqueue(entityManager(app), cv, { kind: 'generate' })),
      );
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(
        LIMITS.GENERATIONS_PER_USER_PER_DAY,
      );
    });
  });

  describe('retry', () => {
    it('continues a failed job: same id, steps kept, attempts and call budget reset, quota charged', async () => {
      const cv = await newCv();
      const failed = await createJob(entityManager(app), {
        cv,
        status: 'failed',
        step: 'write',
        attempts: 3,
        errorCode: 'AI_UNAVAILABLE',
      });
      const job = await queue.retry(entityManager(app), cv);

      expect(job).toMatchObject({ id: failed.id, status: 'queued', step: 'write' });
      expect(job.error).toBeUndefined();
      const row = await entityManager(app).findOneOrFail(GenerationJob, failed.id);
      expect(row).toMatchObject({ attempts: 0, llmCalls: 0, errorCode: null, lockedBy: null });
      expect(await entityManager(app).count(GenerationUsage, {})).toBe(1);
    });

    it('puts the question of a failed apply_answer job back to applying', async () => {
      const cv = await newCv();
      const em = entityManager(app);
      const question = await createQuestion(em, { cv, status: 'answered' });
      question.applyStatus = 'failed';
      await em.flush();
      await createJob(entityManager(app), {
        cv,
        kind: 'apply_answer',
        status: 'failed',
        payload: { questionId: question.id, answer: { type: 'text', text: 'Five people.' } },
      });

      await queue.retry(entityManager(app), cv);
      const fresh = await entityManager(app).findOneOrFail(CvQuestion, question.id);
      expect(fresh.applyStatus).toBe('applying');
      expect(await entityManager(app).count(GenerationUsage, {})).toBe(0);
    });

    it.each([
      ['no job', undefined, 'JOB_NOT_RETRYABLE'],
      ['a succeeded job', 'succeeded', 'JOB_NOT_RETRYABLE'],
      ['a queued job', 'queued', 'JOB_ACTIVE'],
      ['a running job', 'running', 'JOB_ACTIVE'],
    ] as const)('refuses %s', async (_case, status, code) => {
      const cv = await newCv();
      if (status) await createJob(entityManager(app), { cv, status });
      await rejectsWith(queue.retry(entityManager(app), cv), code);
    });
  });

  it('maps a failed job with a default message for its code', async () => {
    const cv = await newCv();
    await createJob(entityManager(app), { cv, status: 'failed', errorCode: 'AI_KEY_REJECTED' });
    expect((await queue.getLatestJob(cv.id))?.error).toEqual({
      code: 'AI_KEY_REJECTED',
      message: expect.stringMatching(/API key/) as string,
    });
  });
});
