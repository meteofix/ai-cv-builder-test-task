import { LOCALES, type Locale } from '@cv/shared';
import type { z } from 'zod';
import { instructionFragments, uncoveredLines, verifyFacts } from '../../grounding/index.js';
import { flattenExtraction } from './flatten-extraction.js';
import { EXTRACTOR_SYSTEM, extractorInput } from './prompts.js';
import { extractorOutputSchema, type SourceFacts } from './schemas.js';

/** One structured call to the extractor model; the job passes `LlmClient.parse`, the eval script its own. */
export type AskExtractor = <T>(request: {
  system: string;
  input: string;
  schema: z.ZodType<T>;
}) => Promise<T>;

/** What the extract step logs and stores as its result: counters only, never text. */
export interface ExtractCounters {
  kept: number;
  dropped: Record<string, number>;
  /** Achievements moved to another position because theirs was not kept, and those left without one. */
  reattached: number;
  unplaced: number;
  instructionLines: number;
  uncoveredLines: number;
}

/**
 * The extract step without the job around it (docs/specs/generation.md §3.1): the extractor's facts,
 * verified against the source, with the instruction lines and the lines no fact covers.
 */
export async function extractSourceFacts(
  text: string,
  ask: AskExtractor,
): Promise<{ stored: SourceFacts; counters: ExtractCounters }> {
  const output = await ask({
    system: EXTRACTOR_SYSTEM,
    input: extractorInput(text),
    schema: extractorOutputSchema,
  });
  const locale: Locale = LOCALES.find((known) => known === output.locale) ?? 'en';
  const instructionSpans = instructionFragments(text, output.ignoredInstructions);
  const { facts, dropped, headers, reattached, unplaced } = verifyFacts(
    text,
    flattenExtraction(output),
    instructionSpans,
    output.sectionHeadings,
  );
  const stored: SourceFacts = {
    locale,
    facts,
    sectionHeadings: output.sectionHeadings,
    instructionSpans,
    uncoveredLines: uncoveredLines(
      text,
      [...facts.map((fact) => fact.span), ...headers, ...instructionSpans],
      output.sectionHeadings,
    ),
    answers: [],
  };
  return {
    stored,
    counters: {
      kept: facts.length,
      dropped: countBy(dropped.map((fact) => fact.reason)),
      reattached,
      unplaced,
      instructionLines: instructionSpans.length,
      uncoveredLines: stored.uncoveredLines.length,
    },
  };
}

export function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}
