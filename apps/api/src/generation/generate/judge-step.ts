import { experienceGroups } from '@cv/shared';
import { sourceLines, type Fact } from '../../grounding/index.js';
import type { LlmClient } from '../../llm/llm-client.js';
import type { JobRun } from '../job-handler.js';
import { JUDGE_SYSTEM, judgeInput, type Evidence } from './prompts.js';
import { positionLabel } from './questions.js';
import { judgeOutputSchema, type JudgeOutput, type RemovedItem } from './schemas.js';

/** A prose item as the judge sees it, with where it would go in the document. */
export interface ItemToJudge {
  id: string;
  text: string;
  /** Where the item will appear: "<title> — <company> (<start> – <end>)", "Summary" or "Unknown position". */
  destination: string;
  evidence: Evidence[];
  /** The position of a bullet; null for a summary sentence. */
  positionId: string | null;
}

/**
 * The evidence the judge needs to catch a duty moved between jobs: each cited quote with the position it
 * stands under in the source (the nearest position before it), which the item's destination must match.
 * Facts past `sourceLength` are the user's answers and say which position they answer for. Lines no fact
 * covers between that position and the quote are passed along as they are (`unrecognizedBefore`): a
 * heading the extractor missed is among them as often as a page footer, and only the judge can tell.
 */
export function judgeEvidence(
  facts: readonly Fact[],
  text: string,
  sourceLength: number,
  uncoveredLines: readonly string[],
) {
  const positions = facts
    .filter((fact): fact is PositionFact => fact.kind === 'position')
    .sort((a, b) => a.span[0] - b.span[0]);
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const uncovered = new Set(uncoveredLines);
  const lines = sourceLines(text.slice(0, sourceLength));
  const label = (id: string | null) => {
    const position = id === null ? undefined : positions.find((candidate) => candidate.id === id);
    return position ? positionDescription(position) : null;
  };
  // Consecutive positions of one company whose title lines are stacked (no bullet between them) share
  // the bullets that follow the last one: such a quote stands under each of them (cv-template 5a).
  const stackedLast = new Map<string, Set<string>>();
  for (const group of experienceGroups(
    positions.map((fact) => ({ id: fact.id, company: fact.position.company, span: fact.span })),
  )) {
    const first = group[0];
    const last = group.at(-1);
    if (!first || !last || group.length < 2) continue;
    // A bullet between the titles, or a line nobody recognized there, means the titles are not stacked.
    const stacked =
      !facts.some(
        (fact) =>
          fact.kind === 'achievement' &&
          fact.span[0] > first.span[0] &&
          fact.span[0] < last.span[0],
      ) &&
      !lines.some(
        ({ span, text: line }) =>
          span[0] >= first.span[1] && span[1] <= last.span[0] && uncovered.has(line.trim()),
      );
    if (stacked) stackedLast.set(last.id, new Set(group.map((position) => position.id)));
  }
  const placement = (fact: Fact, destination: string | null): Omit<Evidence, 'quote'> => {
    if (fact.span[0] >= sourceLength) {
      const about = fact.kind === 'achievement' ? label(fact.achievement.positionId) : null;
      return { appearsUnder: about ? `the user's answer about ${about}` : "the user's answer" };
    }
    const before = positions.filter((position) => position.span[0] <= fact.span[0]).at(-1);
    if (!before) return { appearsUnder: null };
    const shared = destination !== null && stackedLast.get(before.id)?.has(destination) === true;
    const between = lines
      .filter(
        ({ span, text: line }) =>
          span[0] >= before.span[1] && span[1] <= fact.span[0] && uncovered.has(line.trim()),
      )
      .map(({ text: line }) => line.trim().slice(0, MAX_LINE_CHARS));
    // A missed heading tends to open the gap (followed by its dates and location), a sub-heading to close
    // it: when there are too many lines, both ends are kept.
    const kept =
      between.length > MAX_LINES_BETWEEN * 2
        ? [...between.slice(0, MAX_LINES_BETWEEN), ...between.slice(-MAX_LINES_BETWEEN)]
        : between;
    return {
      appearsUnder: (shared ? label(destination) : null) ?? positionDescription(before),
      ...(kept.length > 0 ? { unrecognizedBefore: kept } : {}),
    };
  };
  return {
    destination: (positionId: string | null) =>
      positionId === null ? 'Summary' : (label(positionId) ?? 'Unknown position'),
    /** The quotes of `factIds`, each with where it stands relative to the item's position. */
    evidence: (factIds: readonly string[], destination: string | null = null): Evidence[] =>
      factIds.flatMap((id) => {
        const fact = byId.get(id);
        if (!fact) return [];
        const quote = text.slice(fact.span[0], fact.span[1]).replace(/\s+/g, ' ').trim();
        return [{ quote, ...placement(fact, destination) }];
      }),
  };
}

type PositionFact = Extract<Fact, { kind: 'position' }>;

/** Enough context to see a missed heading, without sending a whole unrecognized section. */
const MAX_LINES_BETWEEN = 3;
const MAX_LINE_CHARS = 200;
const CURRENT_CLAIM = 'current:';

/**
 * "<title> — <company> (<start> – <end>)". The dates keep two positions with the same title and company
 * apart; "present" is left out, because whether a job is current is itself a claim the judge checks.
 */
function positionDescription(position: PositionFact): string {
  const { start, end } = position.position;
  return `${positionLabel(position.position)} (${start ?? '?'} – ${end ?? '?'})`;
}

/**
 * A position marked current is a claim nothing mechanical can check (the code has no words for
 * "present"), so it goes to the judge with the position's own quote; a rejection turns it into a dates
 * question (generation.md §3.3).
 */
export function currentClaims(
  facts: readonly Fact[],
  evidence: (factIds: readonly string[]) => Evidence[],
): ItemToJudge[] {
  return facts
    .filter((fact): fact is PositionFact => fact.kind === 'position' && fact.position.current)
    .map((fact) => ({
      id: `${CURRENT_CLAIM}${fact.id}`,
      text: `Still works in this role: the job "${positionLabel(fact.position)}" has not ended.`,
      destination: positionDescription(fact),
      evidence: evidence([fact.id]),
      positionId: fact.id,
    }));
}

export function isCurrentClaim(item: { itemId: string }): boolean {
  return item.itemId.startsWith(CURRENT_CLAIM);
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
