import type { DroppedFact, DropReason, ExtractedFact, Fact } from './facts.js';
import { findQuote, indexText } from './find-quote.js';
import { checkValues } from './fact-values.js';
import { overlaps, type Span } from './span.js';

export interface VerifiedFacts {
  /** Kept facts, renumbered `f1…fn` in source order. */
  facts: Fact[];
  dropped: DroppedFact[];
}

/**
 * Keeps only facts quoted from the source and clears structural values that are not in their own quote.
 * Facts overlapping an instruction fragment (`instructionFragments`) are removed. Bad model output is a
 * result here, never an exception.
 */
export function verifyFacts(
  source: string,
  extracted: readonly ExtractedFact[],
  instructionSpans: readonly Span[] = [],
): VerifiedFacts {
  const index = indexText(source);
  const dropped: DroppedFact[] = [];
  const drop = (fact: ExtractedFact, reason: DropReason) =>
    dropped.push({ id: fact.id, kind: fact.kind, reason });

  const seen = new Set<string>();
  const located: Fact[] = [];
  for (const fact of extracted) {
    const span = findQuote(index, fact.quote);
    if (!span) {
      drop(fact, 'quote_not_found');
      continue;
    }
    // Only a located fact claims its id: an invented fact must not push out a real one that reuses its id.
    if (seen.has(fact.id)) {
      drop(fact, 'duplicate_id');
      continue;
    }
    seen.add(fact.id);
    if (instructionSpans.some((fragment) => overlaps(span, fragment))) {
      drop(fact, 'instruction');
      continue;
    }
    const sourceText = source.slice(span[0], span[1]);
    const checked = checkValues(fact, source, span);
    if (!checked) {
      drop(fact, 'field_not_in_quote');
      continue;
    }
    // The stored quote is the source's text, so nothing downstream (the writer included) sees the model's copy.
    located.push({ ...checked, quote: sourceText.replace(/\s+/g, ' ').trim(), span });
  }

  // Achievements are resolved last: their position may come later in the model's list.
  const positions = new Set(located.filter((fact) => fact.kind === 'position').map((f) => f.id));
  const kept: Fact[] = [];
  for (const fact of located) {
    if (fact.kind === 'achievement' && !positions.has(fact.achievement.positionId)) {
      drop(fact, 'unknown_position');
    } else {
      kept.push(fact);
    }
  }
  return { facts: renumber(kept), dropped };
}

function renumber(facts: Fact[]): Fact[] {
  const ordered = facts
    .map((fact, order) => ({ fact, order }))
    .sort(
      (a, b) =>
        a.fact.span[0] - b.fact.span[0] || a.fact.span[1] - b.fact.span[1] || a.order - b.order,
    )
    .map(({ fact }) => fact);
  const ids = new Map(ordered.map((fact, i) => [fact.id, `f${i + 1}`]));
  return ordered.map((fact) => {
    const id = ids.get(fact.id) ?? fact.id;
    if (fact.kind !== 'achievement') return { ...fact, id };
    const positionId = ids.get(fact.achievement.positionId) ?? fact.achievement.positionId;
    return { ...fact, id, achievement: { positionId } };
  });
}
