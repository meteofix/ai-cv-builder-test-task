import { checkNumbers, checkReferences, type Fact } from '../../grounding/index.js';
import type { ProseItem, RemovedItem } from './schemas.js';
import { verbatim } from './skeleton.js';

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
