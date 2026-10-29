import { dateSchema, LIMITS } from '@cv/shared';
import { z } from 'zod';
import type { Span } from './span.js';

export type { Span } from './span.js';

export const FACT_KINDS = [
  'contact',
  'position',
  'achievement',
  'education',
  'skill',
  'profile',
  'other',
] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export const CONTACT_FIELDS = ['fullName', 'email', 'phone', 'location', 'link'] as const;

const field = z.string().max(LIMITS.maxFieldChars);
const common = {
  id: z.string().min(1).max(64),
  // No length cap: one long quote ("About me") must not fail the whole extraction. The source bounds it,
  // and the skeleton lists text over the document's limits as unused.
  quote: z.string(),
  /** The extractor found the fact too vague to stand on its own; it becomes a question. */
  vague: z.boolean().optional(),
};

/** The kinds besides positions and achievements; the extractor returns these as they are. */
export const contactFactSchema = z.object({
  ...common,
  kind: z.literal('contact'),
  contact: z.object({ field: z.enum(CONTACT_FIELDS), value: field }),
});
export const educationFactSchema = z.object({
  ...common,
  kind: z.literal('education'),
  education: z.object({
    institution: field,
    degree: field.nullable(),
    start: dateSchema,
    end: dateSchema,
  }),
});
export const skillFactSchema = z.object({
  ...common,
  kind: z.literal('skill'),
  skill: z.object({ name: field }),
});
export const profileFactSchema = z.object({ ...common, kind: z.literal('profile') });
export const otherFactSchema = z.object({
  ...common,
  kind: z.literal('other'),
  other: z.object({ section: field }),
});

/**
 * A fact to verify. The kind decides which structured field it carries, so a fact cannot claim to be a
 * position without the fields a position needs. The server builds positions and achievements from the
 * extractor's experience groups (`flattenExtraction`).
 */
export const extractedFactSchema = z.discriminatedUnion('kind', [
  contactFactSchema,
  z.object({
    ...common,
    kind: z.literal('position'),
    position: z.object({
      company: field,
      /**
       * The text naming the company when it stands apart from the title, such as a company line above
       * several positions; the company is checked there instead of in the position's own quote. Never
       * stored: verification drops it.
       */
      companyQuote: z.string().optional(),
      title: field,
      location: field.nullable(),
      start: dateSchema,
      end: dateSchema,
      current: z.boolean(),
    }),
  }),
  z.object({
    ...common,
    kind: z.literal('achievement'),
    /**
     * Null once verified when no kept position stands above it in the source: the fact stays visible
     * under "Not in your CV" instead of disappearing with a position whose quote failed.
     */
    achievement: z.object({ positionId: z.string().max(64).nullable() }),
  }),
  educationFactSchema,
  skillFactSchema,
  profileFactSchema,
  otherFactSchema,
]);
export type ExtractedFact = z.infer<typeof extractedFactSchema>;

const spanSchema = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);

/** A verified fact: its quote was found in the source at `span`. Stored in `cv_sources.facts`. */
export const factSchema = z.intersection(extractedFactSchema, z.object({ span: spanSchema }));
export type Fact = ExtractedFact & { span: Span };

export const DROP_REASONS = [
  'quote_not_found',
  'field_not_in_quote',
  'instruction',
  'duplicate_id',
] as const;
export type DropReason = (typeof DROP_REASONS)[number];

/** A fact that did not survive the checks; it carries no text, so it can be logged as a counter. */
export interface DroppedFact {
  id: string;
  kind: FactKind;
  reason: DropReason;
}
