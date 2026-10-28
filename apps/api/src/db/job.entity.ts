import { randomUUID } from 'node:crypto';
import { defineEntity, p, type InferEntity } from '@mikro-orm/core';
import { JOB_ERROR_CODES, JOB_KINDS, JOB_STATUSES, JOB_STEPS, type JobTarget } from '@cv/shared';
import { Cv } from './cv.entity.js';
import { User } from './user.entity.js';

export const GenerationJob = defineEntity({
  name: 'GenerationJob',
  tableName: 'generation_jobs',
  properties: {
    id: p
      .uuid()
      .primary()
      .onCreate(() => randomUUID()),
    // Deleting a CV deletes its jobs; a worker holding a deleted job loses its fenced update and stops.
    cv: () => p.manyToOne(Cv).ref().deleteRule('cascade'),
    user: () => p.manyToOne(User).ref().deleteRule('cascade'),
    kind: p.enum(JOB_KINDS),
    status: p.enum(JOB_STATUSES).default('queued'),
    step: p.enum(JOB_STEPS).nullable(),
    attempts: p.integer().default(0),
    maxAttempts: p.integer().default(3),
    runAfter: p.datetime().onCreate(() => new Date()),
    // Lease of the worker that runs the job; every write of a step checks `lockedBy` (fencing).
    lockedBy: p.string().length(64).nullable(),
    lockedUntil: p.datetime().nullable(),
    llmCalls: p.integer().default(0),
    // Results of finished steps, so a restarted job continues without repeating LLM calls.
    // `default` is only the column default; MikroORM would persist the string '{}' as a JSON string scalar,
    // so onCreate supplies an object.
    state: p
      .json<Record<string, unknown>>()
      .default('{}')
      .onCreate(() => ({})),
    // Input of the job by kind; GenerationQueue writes it through a zod schema.
    payload: p
      .json<Record<string, unknown>>()
      .default('{}')
      .onCreate(() => ({})),
    target: p.json<JobTarget>().nullable(),
    errorCode: p.enum(JOB_ERROR_CODES).nullable(),
    errorMessage: p.text().nullable(),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p
      .datetime()
      .onCreate(() => new Date())
      .onUpdate(() => new Date()),
  },
  indexes: [{ properties: ['status', 'runAfter'] }, { properties: ['cv', 'createdAt'] }],
  // One active job per CV, enforced by the database rather than by a check-then-insert race.
  uniques: [
    {
      name: 'generation_jobs_one_active_per_cv',
      properties: ['cv'],
      where: `status in ('queued', 'running')`,
    },
  ],
});

export type IGenerationJob = InferEntity<typeof GenerationJob>;

/**
 * One row per started generation (a new CV or a retry). The daily limits count these rows; they are not
 * tied to the CV, so deleting a CV does not give the quota back.
 */
export const GenerationUsage = defineEntity({
  name: 'GenerationUsage',
  tableName: 'generation_usage',
  properties: {
    id: p
      .uuid()
      .primary()
      .onCreate(() => randomUUID()),
    user: () => p.manyToOne(User).ref().deleteRule('cascade'),
    createdAt: p.datetime().onCreate(() => new Date()),
  },
  indexes: [{ properties: ['user', 'createdAt'] }, { properties: ['createdAt'] }],
});

export type IGenerationUsage = InferEntity<typeof GenerationUsage>;
