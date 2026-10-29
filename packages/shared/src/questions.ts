import { z } from 'zod';
import { dateSchema } from './document.js';
import { LIMITS } from './limits.js';

export const CV_SECTIONS = [
  'contacts',
  'headline',
  'summary',
  'experience',
  'education',
  'skills',
  'additional',
] as const;
export const cvSectionSchema = z.enum(CV_SECTIONS);

/** The part of the CV a question (and the job that applies its answer) is about. */
export const questionTargetSchema = z.object({
  section: cvSectionSchema,
  /** Id of the position, education entry or bullet in the document. */
  itemId: z.string().max(64).optional(),
  /** Field inside the item, for example `dates`, `company` or `degree`. */
  field: z.string().max(64).optional(),
  /** Index in its group of an item the review took out, so the answer puts it back in its place. */
  position: z
    .number()
    .int()
    .min(0)
    .max(Math.max(LIMITS.maxBulletsPerPosition, LIMITS.maxLinesPerEntry))
    .optional(),
});
export type QuestionTarget = z.infer<typeof questionTargetSchema>;

export const QUESTION_KINDS = ['missing', 'vague', 'unverified'] as const;
export const QUESTION_STATUSES = ['open', 'answered', 'dismissed'] as const;
export const ANSWER_TYPES = ['dates', 'text'] as const;
/** Outcome of applying an answer: `partial` means a regenerated bullet failed its checks and was left out. */
export const APPLY_STATUSES = ['applying', 'applied', 'partial', 'failed'] as const;

/** Dates are applied without an LLM; `current` means "to the present", so `end` must be empty. */
export const datesAnswerSchema = z
  .object({ type: z.literal('dates'), start: dateSchema, end: dateSchema, current: z.boolean() })
  .refine((answer) => !(answer.current && answer.end !== null), {
    message: 'A current position has no end date',
    path: ['end'],
  });

export const textAnswerSchema = z.object({
  type: z.literal('text'),
  text: z.string().trim().min(1).max(LIMITS.maxAnswerChars),
});

export const answerSchema = z.discriminatedUnion('type', [datesAnswerSchema, textAnswerSchema]);
export type Answer = z.infer<typeof answerSchema>;

export const answerQuestionRequestSchema = z.object({ answer: answerSchema });
export type AnswerQuestionRequest = z.infer<typeof answerQuestionRequestSchema>;

export const questionSchema = z.object({
  id: z.uuid(),
  kind: z.enum(QUESTION_KINDS),
  target: questionTargetSchema,
  prompt: z.string(),
  /** What the question is about, for example the text of a removed bullet. */
  context: z.string().nullable(),
  answerType: z.enum(ANSWER_TYPES),
  status: z.enum(QUESTION_STATUSES),
  answer: answerSchema.nullable(),
  applyStatus: z.enum(APPLY_STATUSES).nullable(),
  applyNote: z.string().nullable(),
});
export type Question = z.infer<typeof questionSchema>;
