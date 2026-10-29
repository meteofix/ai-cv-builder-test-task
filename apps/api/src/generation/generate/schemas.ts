import { dateSchema, LIMITS, localeSchema } from '@cv/shared';
import { z } from 'zod';
import {
  contactFactSchema,
  educationFactSchema,
  factSchema,
  otherFactSchema,
  profileFactSchema,
  skillFactSchema,
  type Fact,
  type Span,
} from '../../grounding/index.js';

/** Classes of the judge (docs/specs/generation.md §3.3); each removed item keeps the one that removed it. */
export const JUDGE_CLASSES = [
  'role_keyword',
  'unsupported_claim',
  'wrong_reference',
  'moved_between_jobs',
  'invented_trait_or_domain',
  'time_or_negation',
] as const;

/** Why prose was removed: a mechanical check, a judge class, or no verdict at all (fail closed). */
export const REMOVAL_CLASSES = [...JUDGE_CLASSES, 'number_not_in_source', 'no_verdict'] as const;
export type RemovalClass = (typeof REMOVAL_CLASSES)[number];

// ---- Model output (consumed only through these schemas) ----

const field = z.string().max(LIMITS.maxFieldChars);
const quoted = { quote: z.string(), vague: z.boolean().optional() };

/**
 * The jobs of a CV as it lays them out: one group per employer, with its positions and every bullet
 * written under it. The server turns this into flat position and achievement facts (`flattenExtraction`),
 * assigning every id itself, so the model never has to link facts by id.
 */
export const experienceGroupSchema = z.object({
  /** As written; "" when the CV names no employer. */
  company: field,
  /** The text naming the company: its own line above the positions, or the line it shares with a title. */
  companyQuote: z.string(),
  positions: z.array(
    z.object({
      ...quoted,
      title: field,
      location: field.nullable(),
      start: dateSchema,
      end: dateSchema,
      current: z.boolean(),
    }),
  ),
  bullets: z.array(
    z.object({
      ...quoted,
      /** Index into `positions`; null for a bullet the whole group shares. */
      position: z.number().int().nullable(),
    }),
  ),
});
export type ExperienceGroup = z.infer<typeof experienceGroupSchema>;

/** Every other kind as grounding knows it, without an id: the server numbers facts itself. */
const otherKindsSchema = z.discriminatedUnion('kind', [
  contactFactSchema.omit({ id: true }),
  educationFactSchema.omit({ id: true }),
  skillFactSchema.omit({ id: true }),
  profileFactSchema.omit({ id: true }),
  otherFactSchema.omit({ id: true }),
]);
export type OtherKindFact = z.infer<typeof otherKindsSchema>;

export const extractorOutputSchema = z.object({
  /** Any other language is stored as `en`. */
  locale: z.string(),
  experience: z.array(experienceGroupSchema),
  facts: z.array(otherKindsSchema),
  sectionHeadings: z.array(z.string()),
  ignoredInstructions: z.array(z.string()),
});
export type ExtractorOutput = z.infer<typeof extractorOutputSchema>;

const writtenItem = (max: number) =>
  z.object({ text: z.string().min(1).max(max), factIds: z.array(z.string()).max(20) });

export const writerOutputSchema = z.object({
  summary: z.array(writtenItem(LIMITS.maxSummaryChars)).min(1).max(4),
  positions: z.array(
    z.object({
      positionId: z.string(),
      bullets: z.array(writtenItem(LIMITS.maxBulletChars)).max(LIMITS.maxBulletsPerPosition),
    }),
  ),
  experienceOrder: z.array(z.string()),
  skills: z.array(z.string()),
});
export type WriterOutput = z.infer<typeof writerOutputSchema>;

export const judgeOutputSchema = z.object({
  verdicts: z.array(
    z.object({
      itemId: z.string(),
      supported: z.boolean(),
      class: z.enum(JUDGE_CLASSES).optional(),
      reason: z.string().optional(),
    }),
  ),
});
export type JudgeOutput = z.infer<typeof judgeOutputSchema>;

// ---- Stored results (read back through the same schemas) ----

const spanSchema = z.tuple([z.number().int(), z.number().int()]);

/** `cv_sources.facts`: everything the draft and "Not in your CV" need, written by the extract step. */
export const sourceFactsSchema = z.object({
  locale: localeSchema,
  facts: z.array(factSchema),
  sectionHeadings: z.array(z.string()),
  instructionSpans: z.array(spanSchema),
  uncoveredLines: z.array(z.string()),
  /**
   * Facts from applied text answers. They are not in the source: their spans point into the source with
   * every answer appended on its own line, in this order (`withAnswers`).
   */
  answers: z.array(factSchema).default([]),
});
/** Typed with grounding's own `Fact` and `Span`, so verified facts are stored and read back as they are. */
export type SourceFacts = Omit<
  z.infer<typeof sourceFactsSchema>,
  'facts' | 'instructionSpans' | 'answers'
> & {
  facts: Fact[];
  instructionSpans: Span[];
  answers: Fact[];
};

/** The text the spans of answer facts point into: the source, then every answer on its own line. */
export function withAnswers(source: string, answers: readonly Fact[]): string {
  return [source, ...answers.map((fact) => fact.quote)].join('\n');
}

export const proseItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  factIds: z.array(z.string()),
});
export type ProseItem = z.infer<typeof proseItemSchema>;

export const removedItemSchema = z.object({
  itemId: z.string(),
  text: z.string(),
  /** The position of a removed bullet; null for a summary sentence. */
  positionId: z.string().nullable(),
  class: z.enum(REMOVAL_CLASSES),
});
export type RemovedItem = z.infer<typeof removedItemSchema>;

/** `state.write`: prose that passed the mechanical checks, the order, the skill selection, what was removed. */
export const writeResultSchema = z.object({
  summary: z.array(proseItemSchema),
  positions: z.array(z.object({ positionId: z.string(), bullets: z.array(proseItemSchema) })),
  order: z.array(z.string()),
  skills: z.array(z.string()),
  removed: z.array(removedItemSchema),
});
export type WriteResult = z.infer<typeof writeResultSchema>;

/** `state.judge`: what the judge removed. */
export const judgeResultSchema = z.object({ removed: z.array(removedItemSchema) });
export type JudgeResult = z.infer<typeof judgeResultSchema>;

export const bulletsRewriteSchema = z.object({
  bullets: z.array(writtenItem(LIMITS.maxBulletChars)).max(LIMITS.maxBulletsPerPosition),
});
export const summaryRewriteSchema = z.object({
  summary: z.array(writtenItem(LIMITS.maxSummaryChars)).min(1).max(4),
});

/** `state.write` of an `apply_answer` job: the answer as a fact and the regenerated items that passed. */
export const applyWriteResultSchema = z.object({
  answerFact: factSchema,
  items: z.array(proseItemSchema),
  removed: z.array(removedItemSchema),
});
export type ApplyWriteResult = z.infer<typeof applyWriteResultSchema>;
