import { LOCALES, type Locale } from '@cv/shared';
import type { z } from 'zod';
import {
  findQuote,
  indexText,
  instructionFragments,
  overlaps,
  uncoveredLines,
  verifyFacts,
  type ExtractedFact,
} from '../../grounding/index.js';
import { coveragePass } from './extract-coverage.js';
import { repairFacts } from './extract-repair.js';
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
  /** Misquoted facts sent back to the extractor once, and how many of them passed after that. */
  repaired: { asked: number; fixed: number };
  /** Lines sent to the second pass over uncovered lines (0 when it did not run) and the facts it added. */
  coverage: { lines: number; added: number; failed: boolean };
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
  const verify = (
    extracted: readonly ExtractedFact[],
    headings: readonly string[],
    ignored: readonly string[],
  ) => {
    const instructionSpans = instructionFragments(text, ignored);
    const verified = verifyFacts(text, extracted, instructionSpans, headings);
    const covering = [...verified.facts.map((fact) => fact.span), ...verified.headers];
    return {
      ...verified,
      instructionSpans,
      uncovered: uncoveredLines(text, [...covering, ...instructionSpans], headings),
    };
  };
  const { sectionHeadings, ignoredInstructions } = output;
  const extracted = flattenExtraction(output);
  const first = verify(extracted, sectionHeadings, ignoredInstructions);
  const repair = await repairFacts(text, extracted, first.dropped, ask);
  const repaired =
    repair.asked.length === 0 ? first : verify(repair.facts, sectionHeadings, ignoredInstructions);
  const notFixed = new Set(repaired.dropped.map((fact) => fact.id));
  const coverage = await coveragePass({
    text,
    facts: repair.facts,
    dropped: repaired.dropped,
    uncovered: repaired.uncovered,
    sectionHeadings,
    ask,
  });
  const headings = unique([...sectionHeadings, ...(coverage?.sectionHeadings ?? [])]);
  // The second pass may only add facts on lines nothing covered: one that lands on a covered line could
  // spoil a first-pass group line or repeat a bullet under another job.
  const covered = [
    ...repaired.facts.map((fact) => fact.span),
    ...repaired.headers,
    ...repaired.instructionSpans,
  ];
  const index = indexText(text);
  const fresh = (coverage?.facts ?? []).filter((fact) => {
    const span = findQuote(index, fact.quote);
    return span === null || !covered.some((other) => overlaps(other, span));
  });
  const final = coverage
    ? verify(
        [...repair.facts, ...fresh],
        headings,
        unique([...ignoredInstructions, ...coverage.ignoredInstructions]),
      )
    : repaired;
  const { facts, dropped, reattached, unplaced, instructionSpans } = final;
  const stored: SourceFacts = {
    locale,
    facts,
    sectionHeadings: headings,
    instructionSpans,
    uncoveredLines: final.uncovered,
    answers: [],
  };
  return {
    stored,
    counters: {
      kept: facts.length,
      dropped: countBy(dropped.map((fact) => fact.reason)),
      repaired: {
        asked: repair.asked.length,
        fixed: repair.asked.filter((id) => !notFixed.has(id)).length,
      },
      coverage: {
        lines: coverage?.lines ?? 0,
        added: facts.length - repaired.facts.length,
        failed: coverage?.failed ?? false,
      },
      reattached,
      unplaced,
      instructionLines: instructionSpans.length,
      uncoveredLines: stored.uncoveredLines.length,
    },
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}
