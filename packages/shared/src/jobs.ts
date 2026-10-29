import { z } from 'zod';
import { jobErrorCodeSchema } from './errors.js';
import { cvSectionSchema } from './questions.js';

export const JOB_KINDS = ['generate', 'apply_answer'] as const;
export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const;
/**
 * Steps in order, shown by the web app as a stepper. `write` is the author, `judge` the reviewer (the names
 * predate decision 035); `extract` is no longer entered and stays only in the stored check constraint.
 */
export const JOB_STEPS = ['extract', 'write', 'judge', 'finalize'] as const;

export const jobKindSchema = z.enum(JOB_KINDS);
export const jobStatusSchema = z.enum(JOB_STATUSES);
export const jobStepSchema = z.enum(JOB_STEPS);
export type JobKind = z.infer<typeof jobKindSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type JobStep = z.infer<typeof jobStepSchema>;

/** The part of the CV an `apply_answer` job updates; the editor shows "Updating…" on that card. */
export const jobTargetSchema = z.object({
  questionId: z.uuid(),
  section: cvSectionSchema,
  itemId: z.string().max(64).optional(),
});
export type JobTarget = z.infer<typeof jobTargetSchema>;

/** The latest job of a CV, as `GET /api/cvs/:id/job` and `CvDetail.job` return it. */
export const jobSchema = z.object({
  id: z.uuid(),
  kind: jobKindSchema,
  status: jobStatusSchema,
  /** The step running now, or the last one reached; null before the first step starts. */
  step: jobStepSchema.nullable(),
  target: jobTargetSchema.optional(),
  /** Only on a failed job. */
  error: z.object({ code: jobErrorCodeSchema, message: z.string() }).optional(),
});
export type Job = z.infer<typeof jobSchema>;

export const ACTIVE_JOB_STATUSES = ['queued', 'running'] as const satisfies readonly JobStatus[];
