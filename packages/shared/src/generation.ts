import { z } from 'zod';
import { cvDocumentSchema } from './document.js';

/** Built on the fly from the extracted facts while `document` is still empty; null otherwise. */
export const draftResponseSchema = z.object({ draft: cvDocumentSchema.nullable() });
export type DraftResponse = z.infer<typeof draftResponseSchema>;

/**
 * Why a piece of the source is not in the CV: `unused` — a verified fact the writer left out;
 * `unverified` — removed because a check failed (it also became a question); `ignored` — text that looked
 * like an instruction to the model; `not_recognized` — a source line no extracted fact covers.
 */
export const NOT_IN_CV_REASONS = ['unused', 'unverified', 'ignored', 'not_recognized'] as const;

export const notInCvItemSchema = z.object({
  text: z.string(),
  reason: z.enum(NOT_IN_CV_REASONS),
  /** Where it came from, for example the position a fact belongs to. */
  context: z.string().optional(),
});
export type NotInCvItem = z.infer<typeof notInCvItemSchema>;

/**
 * How much of the source the extraction could read: content lines (with a letter, not a heading) and how
 * many of them no fact covers. `low` asks the editor to say so (decision 034). Optional: added later,
 * and absent before the facts exist.
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
});
export type NotInCvResponse = z.infer<typeof notInCvResponseSchema>;
