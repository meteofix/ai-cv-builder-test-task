import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  Cv,
  CvQuestion,
  GenerationJob,
  type ICv,
  type IGenerationJob,
} from '../src/db/entities.js';
import { JobEngine } from '../src/generation/job-engine.js';
import { JobError } from '../src/generation/job-errors.js';
import { entityManager, resetDatabase } from './support/db.js';
import { createCv, createJob, createQuestion, createUser } from './support/factories.js';
import { engineHarness, jobRow } from './generation/engine-harness.js';

/**
 * The job engine with a scripted handler (docs/specs/generation.md §1): claim, steps, fencing, failures.
 * Heartbeat, shutdown and the worker loop are in generation.lifecycle.e2e-spec.ts; the pipeline-level
 * acceptance examples (GEN-13..GEN-19, GEN-23) run the real steps in generation.acceptance.spec.ts.
 */
describe('generation job engine', () => {
  const harness = engineHarness();
  const { clock, calls } = harness;
  let app: NestFastifyApplication;
  let engine: JobEngine;

  beforeAll(async () => {
    app = await harness.start();
    engine = app.get(JobEngine);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    harness.reset();
  });

  async function newCv(): Promise<ICv> {
    const em = entityManager(app);
    return createCv(em, { user: await createUser(em) });
  }
  const row = (id: string) => jobRow(app, id);

  it('claims a queued job under a 30 s lease, starts it at its first step and records success', async () => {
    const job = await createJob(entityManager(app), { cv: await newCv() });
    let whileRunning: IGenerationJob | undefined;
    harness.setScript(async (run) => {
      whileRunning = await row(job.id);
      await run.finish(() => Promise.resolve());
    });
    expect(await engine.processNext()).toBe(true);
    expect(calls).toEqual([{ step: 'extract', state: {}, attempts: 1 }]);
    expect(whileRunning).toMatchObject({ status: 'running', lockedBy: engine.workerId });
    expect(whileRunning?.lockedUntil?.getTime()).toBe(clock.now().getTime() + 30_000);
    expect(await row(job.id)).toMatchObject({
      status: 'succeeded',
      step: 'extract',
      attempts: 1,
      lockedBy: null,
      lockedUntil: null,
    });
    expect(await engine.processNext()).toBe(false);
  });

  it('claims the due job with the earliest run_after first, then the oldest', async () => {
    const em = entityManager(app);
    const base = clock.now().getTime() - 60_000;
    const late = await createJob(em, { cv: await newCv(), runAfter: new Date(base + 2_000) });
    const tieNewer = await createJob(em, {
      cv: await newCv(),
      runAfter: new Date(base),
      createdAt: new Date(base + 1_000),
    });
    const tieOlder = await createJob(em, {
      cv: await newCv(),
      runAfter: new Date(base),
      createdAt: new Date(base),
    });
    const order: string[] = [];
    harness.setScript(async (run) => {
      order.push(run.job.id);
      await run.finish(() => Promise.resolve());
    });
    while (await engine.processNext());
    expect(order).toEqual([tieOlder.id, tieNewer.id, late.id]);
  });

  it('waits for run_after and leaves a live lease alone', async () => {
    await createJob(entityManager(app), {
      cv: await newCv(),
      runAfter: new Date(clock.now().getTime() + 10_000),
    });
    await createJob(entityManager(app), {
      cv: await newCv(),
      status: 'running',
      lockedBy: 'live-worker',
      lockedUntil: new Date(clock.now().getTime() + 1_000),
    });
    expect(await engine.processNext()).toBe(false);
    clock.advance(10_000);
    expect(await engine.processNext()).toBe(true);
    expect(await engine.processNext()).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('resumes a dead worker’s job at its stored step without repeating finished steps', async () => {
    const job = await createJob(entityManager(app), {
      cv: await newCv(),
      status: 'running',
      step: 'write',
      attempts: 1,
      lockedBy: 'dead-worker',
      lockedUntil: new Date(clock.now().getTime() - 1_000),
      state: { extract: { facts: 3 } },
    });
    expect(await engine.processNext()).toBe(true);
    expect(calls).toEqual([{ step: 'write', state: { extract: { facts: 3 } }, attempts: 2 }]);
    expect(await row(job.id)).toMatchObject({ status: 'succeeded', attempts: 2 });
  });

  it('hands one queued job to only one of two parallel claims', async () => {
    await createJob(entityManager(app), { cv: await newCv() });
    const results = await Promise.all([engine.processNext(), engine.processNext()]);
    expect(results.sort()).toEqual([false, true]);
    expect(calls).toHaveLength(1);
  });

  it('saves a step result with the next step in one write, so a retry continues there', async () => {
    const job = await createJob(entityManager(app), { cv: await newCv() });
    harness.setScript(async (run) => {
      if (run.job.step === 'extract') {
        await run.saveStep('extract', { facts: 2 }, 'write');
        throw new JobError('AI_UNAVAILABLE');
      }
      await run.finish(() => Promise.resolve());
    });
    await engine.processNext();
    expect(await row(job.id)).toMatchObject({
      status: 'queued',
      step: 'write',
      state: { extract: { facts: 2 } },
    });
    clock.advance(10_000);
    await engine.processNext();
    expect(calls.map((call) => call.step)).toEqual(['extract', 'write']);
    expect(calls[1]?.state).toEqual({ extract: { facts: 2 } });
  });

  it('does not let a worker that lost its lease write anything', async () => {
    const cv = await newCv();
    const job = await createJob(entityManager(app), { cv });
    let stolen: IGenerationJob | undefined;
    harness.setScript(async (run) => {
      await entityManager(app).nativeUpdate(GenerationJob, { id: job.id }, { lockedBy: 'thief' });
      stolen = await row(job.id);
      await run.finish(async (tx) => {
        await tx.nativeUpdate(Cv, { id: cv.id }, { targetRole: 'written by a stale worker' });
      });
    });
    expect(await engine.processNext()).toBe(true);
    const after = await row(job.id);
    expect(after).toMatchObject({ status: 'running', lockedBy: 'thief', errorCode: null });
    // Not even the failure of the stale run is recorded: the row is exactly as the new owner left it.
    expect(after).toEqual(stolen);
    expect((await entityManager(app).findOneOrFail(Cv, cv.id)).targetRole).not.toMatch(/stale/);
  });

  it('drops the job quietly when the CV is deleted while it runs', async () => {
    const cv = await newCv();
    await createJob(entityManager(app), { cv });
    harness.setScript(async (run) => {
      await entityManager(app).nativeDelete(Cv, { id: cv.id });
      await run.saveStep('extract', {}, 'write');
    });
    await expect(engine.processNext()).resolves.toBe(true);
    expect(await entityManager(app).count(GenerationJob, {})).toBe(0);
  });

  it('re-queues a transient failure after 10 s, then 30 s, and fails on the last attempt', async () => {
    const job = await createJob(entityManager(app), { cv: await newCv() });
    harness.setScript(() => Promise.reject(new JobError('AI_UNAVAILABLE', 'Busy, try later.')));

    const waits: number[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const claimedAt = clock.now().getTime();
      expect(await engine.processNext()).toBe(true);
      const current = await row(job.id);
      if (attempt < 3) {
        // The code and message stay on the row; the API shows them only once the job has failed.
        expect(current).toMatchObject({
          status: 'queued',
          attempts: attempt,
          lockedBy: null,
          lockedUntil: null,
          errorCode: 'AI_UNAVAILABLE',
          errorMessage: 'Busy, try later.',
        });
        waits.push(current.runAfter.getTime() - claimedAt);
        clock.advance(60_000);
      } else {
        expect(current).toMatchObject({
          status: 'failed',
          attempts: 3,
          errorCode: 'AI_UNAVAILABLE',
          errorMessage: 'Busy, try later.',
        });
      }
    }
    expect(waits).toEqual([10_000, 30_000]);
  });

  it('fails at once on a code that a retry cannot fix', async () => {
    const job = await createJob(entityManager(app), { cv: await newCv() });
    harness.setScript(() => Promise.reject(new JobError('AI_KEY_REJECTED')));
    await engine.processNext();
    expect(await row(job.id)).toMatchObject({
      status: 'failed',
      attempts: 1,
      errorCode: 'AI_KEY_REJECTED',
      errorMessage: null,
      step: 'extract',
    });
  });

  it('retries an unexpected exception as INTERNAL without its message, and logs it without row values', async () => {
    const job = await createJob(entityManager(app), { cv: await newCv() });
    const driverError = Object.assign(new Error('duplicate key'), {
      code: '23505',
      detail: 'Key (email)=(iryna@example.com) already exists.',
    });
    harness.setScript(() => Promise.reject(driverError));
    await engine.processNext();
    expect(await row(job.id)).toMatchObject({
      status: 'queued',
      errorCode: 'INTERNAL',
      errorMessage: null,
    });
    const crash = harness.logs.find((line) => line.msg === 'job crashed');
    // pino's error serializer adds `type`; the driver's `detail` (row values) must not be there.
    expect(Object.keys(crash?.err as object).sort()).toEqual([
      'code',
      'message',
      'name',
      'stack',
      'type',
    ]);
    expect(JSON.stringify(harness.logs)).not.toContain('iryna@example.com');
  });

  it('retries a handler that returns without finishing the job as INTERNAL', async () => {
    const job = await createJob(entityManager(app), { cv: await newCv() });
    harness.setScript(() => Promise.resolve());
    await engine.processNext();
    expect(await row(job.id)).toMatchObject({ status: 'queued', errorCode: 'INTERNAL' });
  });

  it.each([
    ['its last stored error', 'AI_UNAVAILABLE', 'AI_UNAVAILABLE'],
    ['INTERNAL when none was stored', null, 'INTERNAL'],
  ] as const)(
    'fails a job whose workers kept dying with %s instead of running it again',
    async (_case, stored, expected) => {
      const job = await createJob(entityManager(app), {
        cv: await newCv(),
        status: 'running',
        step: 'judge',
        attempts: 3,
        lockedBy: 'dead-worker',
        lockedUntil: new Date(clock.now().getTime() - 1_000),
        errorCode: stored,
      });
      await engine.processNext();
      expect(calls).toEqual([]);
      expect(await row(job.id)).toMatchObject({
        status: 'failed',
        step: 'judge',
        errorCode: expected,
      });
    },
  );

  it('fails a job of a kind without a handler with INTERNAL at once', async () => {
    const { apply_answer: applyAnswer } = harness.handlers;
    delete harness.handlers.apply_answer;
    try {
      const job = await createJob(entityManager(app), { cv: await newCv(), kind: 'apply_answer' });
      await engine.processNext();
      expect(await row(job.id)).toMatchObject({
        status: 'failed',
        attempts: 1,
        errorCode: 'INTERNAL',
      });
    } finally {
      harness.handlers.apply_answer = applyAnswer;
    }
  });

  it('marks the question of a failed apply_answer job as failed', async () => {
    const cv = await newCv();
    const question = await createQuestion(entityManager(app), {
      cv,
      status: 'answered',
      applyStatus: 'applying',
    });
    const job = await createJob(entityManager(app), {
      cv,
      kind: 'apply_answer',
      payload: { questionId: question.id, answer: { type: 'text', text: 'Five people.' } },
    });
    harness.setScript(() => Promise.reject(new JobError('AI_REFUSED')));
    await engine.processNext();
    expect(calls[0]?.step).toBe('finalize');
    expect(await row(job.id)).toMatchObject({ status: 'failed', errorCode: 'AI_REFUSED' });
    expect((await entityManager(app).findOneOrFail(CvQuestion, question.id)).applyStatus).toBe(
      'failed',
    );
  });
});
