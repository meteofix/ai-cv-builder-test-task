import { randomUUID } from 'node:crypto';
import {
  checkNumbers,
  checkOrder,
  checkReferences,
  selectSkills,
  type Fact,
} from '../../grounding/index.js';
import type { ProseItem, RemovedItem, WriteResult, WriterOutput } from './schemas.js';
import { verbatim } from './skeleton.js';

export interface ProseCheck {
  result: WriteResult;
  /** For counters: writer output that named a position that does not exist, and an order we replaced. */
  unknownPositions: number;
  orderReplaced: boolean;
}

/**
 * A check of one written item against the facts it cites and the source: it records a failing item in
 * `removed` and returns false.
 */
export function proseChecker(facts: readonly Fact[], source: string) {
  const removed: RemovedItem[] = [];
  const quotes = quotesOf(facts, source);
  const passes = (item: ProseItem, positionId: string | null): boolean => {
    if (!checkReferences(item, positionId, facts)) {
      removed.push({ itemId: item.id, text: item.text, positionId, class: 'wrong_reference' });
      return false;
    }
    if (!checkNumbers(item.text, quotes(item.factIds), source).ok) {
      removed.push({ itemId: item.id, text: item.text, positionId, class: 'number_not_in_source' });
      return false;
    }
    return true;
  };
  return { passes, removed };
}

/** The source text each cited fact stands on, for the number check and the judge. */
export function quotesOf(facts: readonly Fact[], source: string) {
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  return (ids: readonly string[]): string[] =>
    ids.flatMap((id) => {
      const fact = byId.get(id);
      return fact ? [verbatim(source, fact)] : [];
    });
}

/**
 * The mechanical checks of the writer's output (docs/specs/grounding.md §4): an item that fails is
 * removed and remembered with its class, so it becomes a question and shows in "Not in your CV".
 */
export function checkProse(
  output: WriterOutput,
  facts: readonly Fact[],
  source: string,
): ProseCheck {
  const { passes, removed } = proseChecker(facts, source);

  const summary = output.summary
    .map((sentence, i) => ({ id: `s${i + 1}`, ...sentence }))
    .filter((sentence) => passes(sentence, null));

  const positionIds = facts.filter((fact) => fact.kind === 'position').map((fact) => fact.id);
  const known = new Set(positionIds);
  let unknownPositions = 0;
  const positions: WriteResult['positions'] = [];
  for (const { positionId, bullets } of output.positions) {
    // Bullets for a position that does not exist have nowhere to go and no item to ask about.
    if (!known.has(positionId) || positions.some((entry) => entry.positionId === positionId)) {
      unknownPositions++;
      continue;
    }
    positions.push({
      positionId,
      bullets: bullets
        .map((bullet) => ({ id: randomUUID(), ...bullet }))
        .filter((bullet) => passes(bullet, positionId)),
    });
  }

  const orderValid = checkOrder(output.experienceOrder, positionIds);
  return {
    result: {
      summary,
      positions,
      order: orderValid ? output.experienceOrder : positionIds,
      skills: selectSkills(output.skills, facts),
      removed,
    },
    unknownPositions,
    orderReplaced: !orderValid,
  };
}
