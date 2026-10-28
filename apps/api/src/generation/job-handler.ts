import type { EntityManager } from '@mikro-orm/postgresql';
import type { JobKind, JobStep } from '@cv/shared';
import type { ClaimedJob } from './job-store.js';

/** What a handler gets for one run of a job. Every write goes through these fenced methods. */
export interface JobRun {
  /** `job.step` is where this run starts; `job.state[step]` holds the results of finished steps. */
  readonly job: ClaimedJob;
  /** Fires when the lease is lost or the application shuts down; pass it to every LLM call. */
  readonly signal: AbortSignal;
  /**
   * Stores the result of `step` and moves the job to `next` in one fenced update, together with `work`
   * in the same transaction, so a restarted job never repeats a finished step.
   */
  saveStep(
    step: JobStep,
    result: unknown,
    next: JobStep,
    work?: (tx: EntityManager) => Promise<void>,
  ): Promise<void>;
  /** Marks the job succeeded and runs `work` in the same fenced transaction; a run must end with it. */
  finish(work: (tx: EntityManager) => Promise<void>): Promise<void>;
}

export interface JobHandler {
  /** The step a job of this kind starts at (an `apply_answer` job skips the steps its answer does not need). */
  firstStep(job: ClaimedJob): JobStep;
  run(run: JobRun): Promise<void>;
}

/** The handler of each job kind; a kind without one fails with INTERNAL. */
export const JOB_HANDLERS = Symbol('JOB_HANDLERS');
export type JobHandlers = Partial<Record<JobKind, JobHandler>>;
