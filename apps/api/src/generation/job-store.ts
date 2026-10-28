import { EntityManager } from '@mikro-orm/postgresql';
import { Inject, Injectable } from '@nestjs/common';
import type { JobErrorCode, JobKind, JobStep, JobTarget } from '@cv/shared';
import { applyAnswerPayloadSchema } from '../common/generation-queue.js';
import { CvQuestion, GenerationJob, type IGenerationJob } from '../db/entities.js';
import { LeaseLostError } from './job-errors.js';

/** How long a claim or a heartbeat keeps a job; a worker that stops heartbeating loses it after this. */
export const LEASE_MS = 30_000;

/** A job as its worker holds it. `step` and `state` follow the step results the worker saves. */
export interface ClaimedJob {
  id: string;
  cvId: string;
  userId: string;
  kind: JobKind;
  step: JobStep | null;
  attempts: number;
  maxAttempts: number;
  state: Record<string, unknown>;
  payload: Record<string, unknown>;
  target: JobTarget | null;
  errorCode: JobErrorCode | null;
  errorMessage: string | null;
  /** The worker id every write of this job is fenced by. */
  lockedBy: string;
}

type JobUpdate = Partial<
  Pick<
    IGenerationJob,
    | 'status'
    | 'step'
    | 'state'
    | 'runAfter'
    | 'lockedBy'
    | 'lockedUntil'
    | 'errorCode'
    | 'errorMessage'
    | 'updatedAt'
  >
>;

/**
 * Every statement of the job engine on `generation_jobs`. All writes after the claim are fenced by
 * `locked_by`: a write that matches no row means the lease is gone, and it throws `LeaseLostError`.
 */
@Injectable()
export class JobStore {
  constructor(@Inject(EntityManager) private readonly em: EntityManager) {}

  /**
   * Claims the next runnable job in one statement: a queued job whose time has come, or a running job
   * whose worker stopped renewing its lease. `SKIP LOCKED` keeps two workers from claiming the same row.
   */
  async claim(workerId: string, now: Date): Promise<ClaimedJob | null> {
    const em = this.em.fork();
    const rows = await em.execute<Record<string, unknown>[]>(
      `update generation_jobs
          set status = 'running', locked_by = ?, locked_until = ?, attempts = attempts + 1, updated_at = ?
        where id = (
          select id from generation_jobs
           where (status = 'queued' and run_after <= ?) or (status = 'running' and locked_until < ?)
           order by run_after, created_at
           limit 1
           for update skip locked)
        returning *`,
      [workerId, new Date(now.getTime() + LEASE_MS), now, now, now],
    );
    const row = rows[0];
    if (!row) return null;
    const job = em.map(GenerationJob, row);
    return {
      id: job.id,
      cvId: job.cv.id,
      userId: job.user.id,
      kind: job.kind,
      step: job.step ?? null,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      state: job.state,
      payload: job.payload,
      target: job.target ?? null,
      errorCode: job.errorCode ?? null,
      errorMessage: job.errorMessage ?? null,
      lockedBy: workerId,
    };
  }

  /** Extends the lease; false when this worker no longer holds the job. */
  async heartbeat(job: ClaimedJob, now: Date): Promise<boolean> {
    const updated = await this.em
      .fork()
      .nativeUpdate(
        GenerationJob,
        { id: job.id, lockedBy: job.lockedBy, status: 'running' },
        { lockedUntil: new Date(now.getTime() + LEASE_MS) },
      );
    return updated > 0;
  }

  /**
   * Runs `work` in one transaction that first applies `update` to the job under its lease. The fenced
   * update comes first, so it also locks the row: no other worker can claim the job until the commit.
   */
  async fenced<T>(
    job: ClaimedJob,
    update: JobUpdate,
    work?: (tx: EntityManager) => Promise<T>,
  ): Promise<T | undefined> {
    return this.em.fork().transactional(async (tx) => {
      const updated = await tx.nativeUpdate(
        GenerationJob,
        { id: job.id, lockedBy: job.lockedBy, status: 'running' },
        update,
      );
      if (updated === 0) throw new LeaseLostError();
      return work ? await work(tx) : undefined;
    });
  }

  /** Back to the queue for a later attempt; the last error is kept so an exhausted job can report it. */
  async requeue(
    job: ClaimedJob,
    error: { code: JobErrorCode; message: string | null },
    runAfter: Date,
    now: Date,
  ): Promise<void> {
    await this.fenced(job, {
      status: 'queued',
      runAfter,
      lockedBy: null,
      lockedUntil: null,
      errorCode: error.code,
      errorMessage: error.message,
      updatedAt: now,
    });
  }

  /** Final failure; an `apply_answer` job also marks its question as failed. */
  async fail(
    job: ClaimedJob,
    error: { code: JobErrorCode; message: string | null },
    now: Date,
  ): Promise<void> {
    await this.fenced(
      job,
      {
        status: 'failed',
        lockedBy: null,
        lockedUntil: null,
        errorCode: error.code,
        errorMessage: error.message,
        updatedAt: now,
      },
      async (tx) => {
        if (job.kind !== 'apply_answer') return;
        // A failure must always be recordable: a payload the queue did not write leaves the question alone.
        const payload = applyAnswerPayloadSchema.safeParse(job.payload);
        if (!payload.success) return;
        await tx.nativeUpdate(
          CvQuestion,
          { id: payload.data.questionId, cv: job.cvId },
          { applyStatus: 'failed', updatedAt: now },
        );
      },
    );
  }

  /** Gives the job back on shutdown: a stopped process is not a failed attempt. */
  async release(job: ClaimedJob, now: Date): Promise<boolean> {
    const updated = await this.em.fork().execute<{ id: string }[]>(
      `update generation_jobs
          set status = 'queued', locked_by = null, locked_until = null,
              attempts = greatest(attempts - 1, 0), updated_at = ?
        where id = ? and locked_by = ? and status = 'running'
        returning id`,
      [now, job.id, job.lockedBy],
    );
    return updated.length > 0;
  }
}
