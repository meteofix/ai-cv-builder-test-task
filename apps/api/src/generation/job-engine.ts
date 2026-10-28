import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Inject, Injectable, type BeforeApplicationShutdown } from '@nestjs/common';
import type { Logger } from 'pino';
import { ROOT_LOGGER } from '../config/tokens.js';
import { Clock } from './clock.js';
import { errorFields } from './error-fields.js';
import { JOB_HANDLERS, type JobHandlers, type JobRun } from './job-handler.js';
import { JobError, LeaseLostError } from './job-errors.js';
import { JobStore, type ClaimedJob } from './job-store.js';

/** Waits before attempt 2, 3 (and a fourth if `max_attempts` allows) after a retryable failure. */
const BACKOFF_MS = [10_000, 30_000, 60_000] as const;
const HEARTBEAT_MS = 10_000;
/** How long shutdown waits for an aborted job to unwind before the database closes. */
const SHUTDOWN_WAIT_MS = 5_000;

/** Waits for `work`, but no longer than `ms`. */
export async function settleWithin(work: Promise<unknown>, ms: number): Promise<void> {
  const timer = new AbortController();
  await Promise.race([
    work,
    delay(ms, undefined, { signal: timer.signal, ref: false }).catch(() => undefined),
  ]);
  timer.abort();
}

interface InFlight {
  job: ClaimedJob;
  controller: AbortController;
  done: Promise<void>;
}

/**
 * Claims jobs and runs their handlers under a lease. Every write after the claim is fenced by this
 * worker's id, so a worker that lost its lease (heartbeat failed, CV deleted) stops without writing.
 */
@Injectable()
export class JobEngine implements BeforeApplicationShutdown {
  /** Unique per process; it is the `locked_by` of every job this process claims. */
  readonly workerId = `${hostname().slice(0, 24)}-${process.pid}-${randomUUID().slice(0, 8)}`;
  private readonly inFlight = new Map<string, InFlight>();
  private stopping = false;
  private readonly log: Logger;

  constructor(
    @Inject(JobStore) private readonly store: JobStore,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(JOB_HANDLERS) private readonly handlers: JobHandlers,
    @Inject(ROOT_LOGGER) logger: Logger,
  ) {
    this.log = logger.child({ module: 'generation', workerId: this.workerId });
  }

  /** Claims and runs one job; false when there was nothing to do. */
  async processNext(): Promise<boolean> {
    if (this.stopping) return false;
    const job = await this.store.claim(this.workerId, this.clock.now());
    if (!job) return false;
    if (this.isStopping()) {
      // Shutdown started while the claim was on its way: the job is not in flight yet, so give it back here.
      await this.store.release(job, this.clock.now());
      return false;
    }
    const controller = new AbortController();
    const done = this.run(job, controller);
    this.inFlight.set(job.id, { job, controller, done });
    try {
      await done;
    } finally {
      this.inFlight.delete(job.id);
    }
    return true;
  }

  /** A method, not the field: the flag changes while `processNext` awaits the claim. */
  private isStopping(): boolean {
    return this.stopping;
  }

  /** Stops claiming, aborts the jobs in flight and gives them back to the queue before the database closes. */
  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    const jobs = [...this.inFlight.values()];
    for (const { controller } of jobs) controller.abort();
    await Promise.all(jobs.map(({ job }) => this.store.release(job, this.clock.now())));
    await settleWithin(Promise.allSettled(jobs.map(({ done }) => done)), SHUTDOWN_WAIT_MS);
  }

  private async run(job: ClaimedJob, controller: AbortController): Promise<void> {
    const log = this.log.child({ jobId: job.id, kind: job.kind });
    try {
      if (job.attempts > job.maxAttempts) {
        // A job whose workers kept dying: it never gets another run.
        throw new JobError(job.errorCode ?? 'INTERNAL', job.errorMessage ?? undefined, {
          retryable: false,
        });
      }
      const handler = this.handlers[job.kind];
      if (!handler) throw new JobError('INTERNAL', undefined, { retryable: false });
      if (job.step === null) {
        const step = handler.firstStep(job);
        await this.store.fenced(job, { step, updatedAt: this.clock.now() });
        job.step = step;
      }
      log.info({ step: job.step, attempt: job.attempts }, 'job claimed');

      const heartbeat = setInterval(() => void this.beat(job, controller, log), HEARTBEAT_MS);
      heartbeat.unref();
      const context = this.context(job, controller.signal);
      try {
        await handler.run(context.run);
      } finally {
        clearInterval(heartbeat);
      }
      if (!context.finished())
        throw new Error('The job handler returned without finishing the job');
      log.info({ attempt: job.attempts }, 'job succeeded');
    } catch (error) {
      await this.handleFailure(job, error, controller.signal, log);
    }
  }

  private context(job: ClaimedJob, signal: AbortSignal) {
    let finished = false;
    const run: JobRun = {
      job,
      signal,
      saveStep: async (step, result, next, work) => {
        signal.throwIfAborted();
        const state = { ...job.state, [step]: result };
        await this.store.fenced(job, { state, step: next, updatedAt: this.clock.now() }, work);
        job.state = state;
        job.step = next;
      },
      finish: async (work: (tx: EntityManager) => Promise<void>) => {
        signal.throwIfAborted();
        await this.store.fenced(
          job,
          {
            status: 'succeeded',
            lockedBy: null,
            lockedUntil: null,
            errorCode: null,
            errorMessage: null,
            updatedAt: this.clock.now(),
          },
          work,
        );
        finished = true;
      },
    };
    return { run, finished: () => finished };
  }

  /** A failed heartbeat aborts the job; a heartbeat that cannot reach the database lets the lease run out. */
  private async beat(job: ClaimedJob, controller: AbortController, log: Logger): Promise<void> {
    try {
      if (!(await this.store.heartbeat(job, this.clock.now()))) {
        log.info('job lease lost, stopping');
        controller.abort();
      }
    } catch (error) {
      log.warn({ err: errorFields(error) }, 'job heartbeat failed');
    }
  }

  private async handleFailure(
    job: ClaimedJob,
    error: unknown,
    signal: AbortSignal,
    log: Logger,
  ): Promise<void> {
    if (signal.aborted || error instanceof LeaseLostError) {
      log.info('job stopped without writes: lease lost, CV deleted or shutting down');
      return;
    }
    // Anything that is not a JobError (a bug, a database error) is retried within the attempt limit.
    const failure =
      error instanceof JobError
        ? error
        : new JobError('INTERNAL', undefined, { retryable: true, cause: error });
    if (!(error instanceof JobError)) log.error({ err: errorFields(error) }, 'job crashed');
    const record = { code: failure.code, message: failure.userMessage ?? null };
    const now = this.clock.now();
    try {
      if (failure.retryable && job.attempts < job.maxAttempts) {
        const wait = BACKOFF_MS[Math.min(job.attempts, BACKOFF_MS.length) - 1] ?? BACKOFF_MS[0];
        await this.store.requeue(job, record, new Date(now.getTime() + wait), now);
        log.warn({ code: failure.code, attempt: job.attempts, waitMs: wait }, 'job re-queued');
      } else {
        await this.store.fail(job, record, now);
        log.warn({ code: failure.code, attempt: job.attempts }, 'job failed');
      }
    } catch (writeError) {
      if (!(writeError instanceof LeaseLostError)) throw writeError;
      log.info('job lease lost before its failure was recorded');
    }
  }
}
