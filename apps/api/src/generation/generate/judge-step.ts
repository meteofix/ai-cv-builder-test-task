import type { LlmClient } from '../../llm/llm-client.js';
import type { JobRun } from '../job-handler.js';
import { JUDGE_SYSTEM, judgeInput } from './prompts.js';
import { judgeOutputSchema, type JudgeOutput, type RemovedItem } from './schemas.js';

/** A prose item as the judge sees it, with where it would go in the document. */
export interface ItemToJudge {
  id: string;
  text: string;
  quotes: string[];
  /** The position of a bullet; null for a summary sentence. */
  positionId: string | null;
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
      items: items.map(({ id, text, quotes }) => ({ id, text, quotes })),
      targetRole,
    }),
    schema: judgeOutputSchema,
    job: run.job,
    signal: run.signal,
  });
  return applyVerdicts(items, output.verdicts);
}
