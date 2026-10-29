import { z } from 'zod';
import { cvDocumentSchema } from './document.js';
import { cvSectionSchema } from './questions.js';

/** Always null: the author writes the whole CV in one step (decision 035). */
export const draftResponseSchema = z.object({ draft: cvDocumentSchema.nullable() });
export type DraftResponse = z.infer<typeof draftResponseSchema>;

/**
 * Why a piece of the source is not in the CV (decision 035): `not_included` — the author left it out on
 * purpose and says why; `not_placed` — no part of the CV cites it and the author gave no reason (usually
 * none); `ignored` — text that looked like an instruction to the model, never shown to one.
 */
export const NOT_IN_CV_REASONS = ['not_included', 'not_placed', 'ignored'] as const;

export const notInCvItemSchema = z.object({
  /** The source text, word for word. */
  text: z.string(),
  reason: z.enum(NOT_IN_CV_REASONS),
  /** The author's reason for `not_included`. */
  context: z.string().optional(),
  /** Where the text belongs, for "Add": the section, and the position or group inside it. */
  section: cvSectionSchema.optional(),
  itemId: z.string().max(64).optional(),
});
export type NotInCvItem = z.infer<typeof notInCvItemSchema>;

/**
 * How much of the source reached the CV: content segments (with a letter, not an instruction) and how many
 * of them nothing cites. `low` asks the editor to say so (decision 034). Absent before a generation ends.
 */
export const sourceCoverageSchema = z.object({
  contentLines: z.number().int().nonnegative(),
  notRecognized: z.number().int().nonnegative(),
  low: z.boolean(),
});
export type SourceCoverage = z.infer<typeof sourceCoverageSchema>;

export const notInCvResponseSchema = z.object({
  items: z.array(notInCvItemSchema),
  sourceCoverage: sourceCoverageSchema.optional(),
  /** Why the author put an older job before a newer one; absent when the experience is newest first. */
  orderReason: z.string().optional(),
});
export type NotInCvResponse = z.infer<typeof notInCvResponseSchema>;
