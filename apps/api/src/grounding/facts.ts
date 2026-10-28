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

/**
 * A fact as the extractor returns it. The kind decides which structured field it carries, so a fact
 * cannot claim to be a position without the fields a position needs.
 */
export const extractedFactSchema = z.discriminatedUnion('kind', [
  z.object({
    ...common,
    kind: z.literal('contact'),
    contact: z.object({ field: z.enum(CONTACT_FIELDS), value: field }),
  }),
  z.object({
    ...common,
    kind: z.literal('position'),
    position: z.object({
      company: field,
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
    achievement: z.object({ positionId: z.string().max(64) }),
  }),
  z.object({
    ...common,
    kind: z.literal('education'),
    education: z.object({
      institution: field,
      degree: field.nullable(),
      start: dateSchema,
      end: dateSchema,
    }),
  }),
  z.object({ ...common, kind: z.literal('skill'), skill: z.object({ name: field }) }),
  z.object({ ...common, kind: z.literal('profile') }),
  z.object({ ...common, kind: z.literal('other'), other: z.object({ section: field }) }),
]);
export type ExtractedFact = z.infer<typeof extractedFactSchema>;

const spanSchema = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);

/** A verified fact: its quote was found in the source at `span`. Stored in `cv_sources.facts`. */
export const factSchema = z.intersection(extractedFactSchema, z.object({ span: spanSchema }));
export type Fact = ExtractedFact & { span: Span };

export const DROP_REASONS = [
  'quote_not_found',
  'field_not_in_quote',
  'unknown_position',
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
