import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { Inject, Injectable } from '@nestjs/common';
import {
  ACTIVE_JOB_STATUSES,
  answerSchema,
  jobTargetSchema,
  type Job,
  type JobTarget,
} from '@cv/shared';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';
import { APP_CONFIG } from '../config/tokens.js';
import {
  CvQuestion,
  GenerationJob,
  GenerationUsage,
  type ICv,
  type IGenerationJob,
} from '../db/entities.js';
import { ApiError } from './api-error.js';

/** What an `apply_answer` job needs; the worker reads it back through the same schema. */
export const applyAnswerPayloadSchema = z.object({ questionId: z.uuid(), answer: answerSchema });
export type ApplyAnswerPayload = z.infer<typeof applyAnswerPayloadSchema>;

/** `generate` reads the source text from `cv_sources`; `apply_answer` carries the answer and its target. */
export type EnqueueInput =
  { kind: 'generate' } | { kind: 'apply_answer'; target: JobTarget; payload: ApplyAnswerPayload };

/** Any constant works; it only has to be the same for every process that charges the quota. */
const QUOTA_LOCK_KEY = 4_211_028;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Default texts for failed jobs; the worker may store a more specific one. */
const JOB_ERROR_MESSAGES: Record<NonNullable<IGenerationJob['errorCode']>, string> = {
  AI_UNAVAILABLE: 'The AI service is unavailable. Try again in a few minutes.',
  AI_LIMIT_REACHED: 'The AI could not finish within its call budget.',
  AI_REFUSED: 'The AI refused to process this CV.',
  AI_KEY_REJECTED: 'The AI service rejected the server’s API key.',
  INTERNAL: 'Something went wrong while generating the CV.',
};

/**
 * Puts generation work in the queue and reads its state. It lives in `common/` because the CV endpoints
 * enqueue jobs and the generation module runs and retries them; both use this one contract and the one
 * `Job` mapper. Ownership is checked by the caller (`findOwned`) before any call here.
 */
@Injectable()
export class GenerationQueue {
  constructor(
    @Inject(EntityManager) private readonly em: EntityManager,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Queues a job for the CV. Pass the caller's transactional `em` so the job commits together with the CV
   * or the answer. `generate` counts against the daily limits; a second active job is 409 JOB_ACTIVE.
   */
  async enqueue(em: EntityManager, cv: ICv, input: EnqueueInput): Promise<Job> {
    return this.guardActive(() =>
      em.transactional(async (tx) => {
        if (await this.hasActiveJob(cv.id, tx)) throw new ApiError('JOB_ACTIVE');
        if (input.kind === 'generate') await this.charge(tx, cv.user.id);
        const job = tx.create(GenerationJob, {
          cv,
          user: cv.user,
          kind: input.kind,
          ...(input.kind === 'apply_answer'
            ? {
                target: jobTargetSchema.parse(input.target),
                payload: applyAnswerPayloadSchema.parse(input.payload),
              }
            : {}),
        });
        await tx.flush();
        return toJobDto(job);
      }),
    );
  }

  /**
   * The latest job of the CV as the API returns it (`CvDetail.job`, `GET /job`), or null. Reads run on a
   * fresh fork unless an `em` is given, so they also work outside a request (the worker, tests).
   */
  async getLatestJob(cvId: string, em: EntityManager = this.em.fork()): Promise<Job | null> {
    const job = await this.latest(cvId, em);
    return job ? toJobDto(job) : null;
  }

  async hasActiveJob(cvId: string, em: EntityManager = this.em.fork()): Promise<boolean> {
    return (await em.count(GenerationJob, { cv: cvId, status: { $in: ACTIVE_JOB_STATUSES } })) > 0;
  }

  /**
   * Continues the latest failed job: finished steps are kept, attempts and the LLM call budget start over.
   * A retried `generate` counts against the daily limits, like a new CV.
   */
  async retry(em: EntityManager, cv: ICv): Promise<Job> {
    return this.guardActive(() =>
      em.transactional(async (tx) => {
        const job = await this.latest(cv.id, tx);
        if (job && ACTIVE_JOB_STATUSES.some((status) => status === job.status)) {
          throw new ApiError('JOB_ACTIVE');
        }
        if (job?.status !== 'failed') throw new ApiError('JOB_NOT_RETRYABLE');
        if (job.kind === 'generate') await this.charge(tx, cv.user.id);

        Object.assign(job, {
          status: 'queued',
          attempts: 0,
          llmCalls: 0,
          runAfter: new Date(),
          lockedBy: null,
          lockedUntil: null,
          errorCode: null,
          errorMessage: null,
        } satisfies Partial<IGenerationJob>);
        if (job.kind === 'apply_answer') {
          const { questionId } = applyAnswerPayloadSchema.parse(job.payload);
          await tx.nativeUpdate(
            CvQuestion,
            { id: questionId, cv: cv.id },
            { applyStatus: 'applying', applyNote: null },
          );
        }
        await tx.flush();
        return toJobDto(job);
      }),
    );
  }

  private latest(cvId: string, em: EntityManager): Promise<IGenerationJob | null> {
    return em.findOne(GenerationJob, { cv: cvId }, { orderBy: { createdAt: 'desc', id: 'desc' } });
  }

  /**
   * Records one generation for the user after checking both daily limits. The advisory lock serializes
   * concurrent charges, so two parallel requests cannot both take the last unit of the quota.
   */
  private async charge(tx: EntityManager, userId: string): Promise<void> {
    await tx.execute('select pg_advisory_xact_lock(?)', [QUOTA_LOCK_KEY]);
    const since = new Date(Date.now() - DAY_MS);
    const mine = await tx.count(GenerationUsage, { user: userId, createdAt: { $gt: since } });
    if (mine >= this.config.GENERATIONS_PER_USER_PER_DAY) {
      throw new ApiError(
        'GENERATION_LIMIT_REACHED',
        `You can start ${this.config.GENERATIONS_PER_USER_PER_DAY} generations a day. Try again tomorrow.`,
      );
    }
    const everyone = await tx.count(GenerationUsage, { createdAt: { $gt: since } });
    if (everyone >= this.config.GENERATIONS_TOTAL) {
      throw new ApiError(
        'GENERATION_LIMIT_REACHED',
        'The service has reached its daily generation limit. Try again tomorrow.',
      );
    }
    tx.create(GenerationUsage, { user: userId });
  }

  /** The partial unique index is the final word on "one active job per CV" when two requests race. */
  private async guardActive<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) throw new ApiError('JOB_ACTIVE');
      throw error;
    }
  }
}

/** The one mapper from a job row to the `Job` contract. */
export function toJobDto(job: IGenerationJob): Job {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    step: job.step ?? null,
    ...(job.target ? { target: job.target } : {}),
    ...(job.status === 'failed'
      ? {
          error: {
            code: job.errorCode ?? 'INTERNAL',
            message: job.errorMessage ?? JOB_ERROR_MESSAGES[job.errorCode ?? 'INTERNAL'],
          },
        }
      : {}),
  };
}
