import { contentLines, type DroppedFact, type ExtractedFact } from '../../grounding/index.js';
import type { AskExtractor } from './extract-step.js';
import { flattenExtraction } from './flatten-extraction.js';
import { COVERAGE_SYSTEM, coverageInput, type KnownPosition } from './prompts.js';
import { JobError, OPTIONAL_REQUEST_FAILURES } from '../job-errors.js';
import { coverageOutputSchema, type CoverageOutput } from './schemas.js';

/**
 * Share of content lines left uncovered above which the extractor gets a second pass over them. Chosen on
 * the dev corpus (R0 report): clean one-column CVs stay below it after one pass, the CVs that lost a
 * sidebar or a page to the first pass are far above it.
 */
export const COVERAGE_THRESHOLD = 0.15;

export interface CoverageResult {
  /** New flat facts, ids prefixed `c`, to verify together with the first pass's facts. */
  facts: ExtractedFact[];
  sectionHeadings: string[];
  ignoredInstructions: string[];
  /** Lines sent to the second pass. */
  lines: number;
  /** The request failed on the model's side; nothing was added. */
  failed: boolean;
}

/**
 * The second pass (docs/specs/generation.md §3.1): when too many content lines are still uncovered, the
 * extractor reads only those lines, with the jobs found so far as labels, so their bullets can join a
 * job. The answer is flattened like the first one; the caller verifies everything together.
 */
export async function coveragePass(input: {
  text: string;
  facts: readonly ExtractedFact[];
  dropped: readonly DroppedFact[];
  uncovered: readonly string[];
  sectionHeadings: readonly string[];
  ask: AskExtractor;
}): Promise<CoverageResult | null> {
  const total = contentLines(input.text, input.sectionHeadings).length;
  if (total === 0 || input.uncovered.length / total <= COVERAGE_THRESHOLD) return null;
  const dropped = new Set(input.dropped.map((fact) => fact.id));
  const positions = input.facts.flatMap((fact) =>
    fact.kind === 'position' && !dropped.has(fact.id) ? [fact] : [],
  );
  const labels = new Map(positions.map((fact, i) => [`P${i + 1}`, fact.id]));
  // The model's own values label the jobs (some may have been cleared by the checks): a label only lets
  // the model point at a job, the bullet is placed and verified by the server.
  const known: KnownPosition[] = positions.map((fact, i) => ({
    label: `P${i + 1}`,
    title: fact.position.title,
    company: fact.position.company,
    dates: `${fact.position.start ?? '?'} – ${fact.position.current ? 'present' : (fact.position.end ?? '?')}`,
  }));
  let output: CoverageOutput;
  try {
    output = await input.ask({
      system: COVERAGE_SYSTEM,
      input: coverageInput(input.uncovered, known),
      schema: coverageOutputSchema,
    });
  } catch (error) {
    // Like the repair, the second pass is optional: what the first pass found stands.
    if (error instanceof JobError && OPTIONAL_REQUEST_FAILURES.has(error.code)) {
      return {
        facts: [],
        sectionHeadings: [],
        ignoredInstructions: [],
        lines: input.uncovered.length,
        failed: true,
      };
    }
    throw error;
  }
  const bullets = output.bullets.map(({ quote, vague, position }, i): ExtractedFact => ({
    id: `cb${i}`,
    kind: 'achievement',
    quote,
    ...(vague ? { vague } : {}),
    // An unknown label names no position; grounding places such a bullet itself.
    achievement: { positionId: (position === null ? undefined : labels.get(position)) ?? 'c' },
  }));
  return {
    facts: [...bullets, ...flattenExtraction(output, 'c')],
    sectionHeadings: output.sectionHeadings,
    ignoredInstructions: output.ignoredInstructions,
    lines: input.uncovered.length,
    failed: false,
  };
}
