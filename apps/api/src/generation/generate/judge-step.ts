import type { Fact } from '../../grounding/index.js';
import type { LlmClient } from '../../llm/llm-client.js';
import type { JobRun } from '../job-handler.js';
import { JUDGE_SYSTEM, judgeInput, type Evidence } from './prompts.js';
import { positionLabel } from './questions.js';
import { judgeOutputSchema, type JudgeOutput, type RemovedItem } from './schemas.js';

/** A prose item as the judge sees it, with where it would go in the document. */
export interface ItemToJudge {
  id: string;
  text: string;
  /** Where the item will appear: "<title> — <company>" of its position, or "Summary". */
  destination: string;
  evidence: Evidence[];
  /** The position of a bullet; null for a summary sentence. */
  positionId: string | null;
}

/**
 * The evidence the judge needs to catch a duty moved between jobs: each cited quote with the position it
 * stands under in the source (the nearest position before it), which the item's destination must match.
 * Facts past `sourceLength` are the user's answers and say which position they answer for.
 */
export function judgeEvidence(facts: readonly Fact[], text: string, sourceLength: number) {
  const positions = facts
    .filter((fact): fact is Extract<Fact, { kind: 'position' }> => fact.kind === 'position')
    .sort((a, b) => a.span[0] - b.span[0]);
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  // Dates in the label keep two positions with the same title and company apart.
  const labelOf = (position: Extract<Fact, { kind: 'position' }>) => {
    const { start, end, current } = position.position;
    return `${positionLabel(position.position)} (${start ?? '?'} – ${current ? 'present' : (end ?? '?')})`;
  };
  const label = (id: string | null) => {
    const position = id === null ? undefined : positions.find((candidate) => candidate.id === id);
    return position ? labelOf(position) : null;
  };
  const appearsUnder = (fact: Fact): string | null => {
    if (fact.span[0] >= sourceLength) {
      const about = fact.kind === 'achievement' ? label(fact.achievement.positionId) : null;
      return about ? `the user's answer about ${about}` : "the user's answer";
    }
    const before = positions.filter((position) => position.span[0] <= fact.span[0]).at(-1);
    return before ? labelOf(before) : null;
  };
  return {
    destination: (positionId: string | null) =>
      positionId === null ? 'Summary' : (label(positionId) ?? 'Unknown position'),
    evidence: (factIds: readonly string[]): Evidence[] =>
      factIds.flatMap((id) => {
        const fact = byId.get(id);
        if (!fact) return [];
        const quote = text.slice(fact.span[0], fact.span[1]).replace(/\s+/g, ' ').trim();
        return [{ quote, appearsUnder: appearsUnder(fact) }];
      }),
  };
}

/**
 * Fail closed: an item without a verdict is as unsupported as one the judge rejected. The first verdict
 * per item counts, verdicts for unknown items are ignored, and a rejection without a class counts as an
 * unsupported claim.
 */
export function applyVerdicts(
  items: readonly ItemToJudge[],
  verdicts: JudgeOutput['verdicts'],
): RemovedItem[] {
  const first = new Map<string, JudgeOutput['verdicts'][number]>();
  for (const verdict of verdicts) {
    if (!first.has(verdict.itemId)) first.set(verdict.itemId, verdict);
  }
  return items.flatMap((item): RemovedItem[] => {
    const verdict = first.get(item.id);
    if (verdict?.supported) return [];
    return [
      {
        itemId: item.id,
        text: item.text,
        positionId: item.positionId,
        class: verdict ? (verdict.class ?? 'unsupported_claim') : 'no_verdict',
      },
    ];
  });
}

/** One judge call for all items; no call when nothing is left to judge. */
export async function judgeProse(
  llm: LlmClient,
  run: JobRun,
  items: readonly ItemToJudge[],
  targetRole: string,
): Promise<RemovedItem[]> {
  if (items.length === 0) return [];
  const output = await llm.parse({
    role: 'judge',
    system: JUDGE_SYSTEM,
    input: judgeInput({
      items: items.map(({ id, text, destination, evidence }) => ({
        id,
        text,
        destination,
        evidence,
      })),
      targetRole,
    }),
    schema: judgeOutputSchema,
    job: run.job,
    signal: run.signal,
  });
  return applyVerdicts(items, output.verdicts);
}
