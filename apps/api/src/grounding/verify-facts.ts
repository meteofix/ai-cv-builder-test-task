import type { DroppedFact, DropReason, ExtractedFact, Fact } from './facts.js';
import { findQuote, indexText } from './find-quote.js';
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
    const checked = checkValues(fact);
    if (!checked) {
      drop(fact, 'field_not_in_quote');
      continue;
    }
    located.push({ ...checked, span });
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

/** The fact with values not found in its quote cleared, or null when the fact means nothing without them. */
function checkValues(fact: ExtractedFact): ExtractedFact | null {
  const inQuote = (value: string) => findQuote(fact.quote, value) !== null;
  const text = (value: string) => (inQuote(value) ? value : '');
  const optional = (value: string | null) => (value !== null && inQuote(value) ? value : null);
  // Months are not checked: only the year has to be in the quote.
  const date = (value: string | null) =>
    value !== null && inQuote(value.slice(0, 4)) ? value : null;

  switch (fact.kind) {
    case 'position': {
      const { company, title, location, start, end, current } = fact.position;
      return {
        ...fact,
        position: {
          company: text(company),
          title: text(title),
          location: optional(location),
          start: date(start),
          end: date(end),
          current,
        },
      };
    }
    case 'education': {
      const { institution, degree, start, end } = fact.education;
      return {
        ...fact,
        education: {
          institution: text(institution),
          degree: optional(degree),
          start: date(start),
          end: date(end),
        },
      };
    }
    case 'skill':
      return inQuote(fact.skill.name) ? fact : null;
    case 'contact':
      return inQuote(fact.contact.value) ? fact : null;
    default:
      return fact;
  }
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
