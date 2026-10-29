import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cv, GenerationJob, type ICv } from '../src/db/entities.js';
import { LeaseLostError } from '../src/generation/job-errors.js';
import { JobEngine } from '../src/generation/job-engine.js';
import { JobStore } from '../src/generation/job-store.js';
import { entityManager, resetDatabase } from './support/db.js';
import { createCv, createJob, createUser } from './support/factories.js';
import { engineHarness, jobRow, signal } from './generation/engine-harness.js';

/** Heartbeat, shutdown and the background loop of the job engine (docs/specs/generation.md §1.1, §1.3, §1.7). */
describe('generation job lifecycle', () => {
  const harness = engineHarness();
  const { clock } = harness;
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
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function newCv(on = app): Promise<ICv> {
    const em = entityManager(on);
    return createCv(em, { user: await createUser(em) });
  }
  const row = (id: string) => jobRow(app, id);

  describe('heartbeat', () => {
    /** Starts a job whose handler waits until the test releases it or the job is aborted. */
    async function startWaitingJob() {
      const job = await createJob(entityManager(app), { cv: await newCv() });
      const started = signal();
      const release = signal();
      let aborted = false;
      harness.setScript(async (run) => {
        run.signal.addEventListener('abort', () => {
          aborted = true;
          release.fire();
        });
        started.fire();
        await release.promise;
        run.signal.throwIfAborted();
        await run.finish(() => Promise.resolve());
      });
      const processed = engine.processNext();
      await started.promise;
      return { job, processed, release: release.fire, aborted: () => aborted };
    }

    it('extends the lease every 10 s', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const { job, processed, release } = await startWaitingJob();
      clock.advance(25_000);
      await vi.advanceTimersByTimeAsync(10_000);
      await vi.waitFor(async () => {
        expect((await row(job.id)).lockedUntil?.getTime()).toBe(clock.now().getTime() + 30_000);
      });
      release();
      await processed;
      expect((await row(job.id)).status).toBe('succeeded');
    });

    it('aborts the job when the lease is gone and writes nothing', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const { job, processed, aborted } = await startWaitingJob();
      await entityManager(app).nativeUpdate(GenerationJob, { id: job.id }, { lockedBy: 'thief' });
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(processed).resolves.toBe(true);
      expect(aborted()).toBe(true);
      expect(await row(job.id)).toMatchObject({ status: 'running', lockedBy: 'thief' });
    });

    it('keeps the job running when a heartbeat cannot reach the database', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      vi.spyOn(app.get(JobStore), 'heartbeat').mockRejectedValueOnce(new Error('connection lost'));
      const { job, processed, release, aborted } = await startWaitingJob();
      await vi.advanceTimersByTimeAsync(10_000);
      await vi.waitFor(() => {
        expect(harness.logs.some((line) => line.msg === 'job heartbeat failed')).toBe(true);
      });
      expect(aborted()).toBe(false);
      release();
      await processed;
      expect((await row(job.id)).status).toBe('succeeded');
    });
  });

  describe('shutdown', () => {
    it('gives the job in flight back to the queue without counting the attempt and waits for it', async () => {
      const own = await harness.start();
      const job = await createJob(entityManager(own), { cv: await newCv(own), attempts: 1 });
      const started = signal();
      harness.setScript(
        (run) =>
          new Promise<void>((_resolve, reject) => {
            run.signal.addEventListener('abort', () => {
              // Unwinds a little after the abort, like an HTTP request that is being cancelled.
              setTimeout(() => {
                reject(new Error('aborted'));
              }, 100);
            });
            started.fire();
          }),
      );
      let settled = false;
      const processed = own
        .get(JobEngine)
        .processNext()
        .finally(() => {
          settled = true;
        });
      await started.promise;
      await own.close();
      expect(settled).toBe(true);
      await expect(processed).resolves.toBe(true);
      expect(await row(job.id)).toMatchObject({
        status: 'queued',
        lockedBy: null,
        lockedUntil: null,
        attempts: 1,
      });
    });

    it('gives back a job claimed while shutdown started, and claims nothing afterwards', async () => {
      const own = await harness.start();
      const job = await createJob(entityManager(own), { cv: await newCv(own) });
      const ownEngine = own.get(JobEngine);
      const store = own.get(JobStore);
      const claim = store.claim.bind(store);
      vi.spyOn(store, 'claim').mockImplementation(async (...args) => {
        const claimed = await claim(...args);
        await ownEngine.beforeApplicationShutdown();
        return claimed;
      });
      expect(await ownEngine.processNext()).toBe(false);
      expect(await ownEngine.processNext()).toBe(false);
      await own.close();
      expect(harness.calls).toEqual([]);
      expect(await row(job.id)).toMatchObject({ status: 'queued', lockedBy: null, attempts: 0 });
    });
  });

  it('lets a CV delete and a finalization take turns instead of deadlocking', async () => {
    const cv = await newCv();
    await createJob(entityManager(app), { cv });
    const store = app.get(JobStore);
    const claimed = await store.claim('worker-x', clock.now());
    if (!claimed) throw new Error('nothing claimed');
    const locked = signal();
    const release = signal();
    // The delete path: the CV row first, then the cascade to its jobs.
    const deletion = entityManager(app).transactional(async (tx) => {
      await tx.execute('select id from cvs where id = ? for update', [cv.id]);
      locked.fire();
      await release.promise;
      await tx.execute('delete from cvs where id = ?', [cv.id]);
    });
    await locked.promise;
    const finalize = store.fenced(claimed, { status: 'succeeded' }, async (tx) => {
      await tx.nativeUpdate(Cv, { id: cv.id }, { targetRole: 'finalized' });
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    release.fire();
    await expect(deletion).resolves.toBeUndefined();
    await expect(finalize).rejects.toBeInstanceOf(LeaseLostError);
    expect(await entityManager(app).count(Cv, { id: cv.id })).toBe(0);
  });

  it('runs queued jobs in the background when WORKER_ENABLED is true', async () => {
    const worker = await harness.start({ WORKER_ENABLED: true });
    try {
      const job = await createJob(entityManager(worker), { cv: await newCv(worker) });
      await vi.waitFor(
        async () => {
          expect((await row(job.id)).status).toBe('succeeded');
        },
        { timeout: 10_000 },
      );
    } finally {
      await worker.close();
    }
  }, 20_000);
});
