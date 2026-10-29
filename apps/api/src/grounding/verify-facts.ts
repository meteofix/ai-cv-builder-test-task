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
    const sourceText = source.slice(span[0], span[1]);
    const checked = checkValues(fact, sourceText);
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

/**
 * The fact with every value taken from the source text at its span: a value not found there is cleared,
 * or the fact is dropped when it means nothing without it. The stored value is the user's own text at the
 * match, never the model's spelling (`ab.example.com` found as `a-b.example.com` keeps `a-b.example.com`).
 */
function checkValues(fact: ExtractedFact, located: string): ExtractedFact | null {
  const index = indexText(located);
  const fromSource = (value: string, keepSigns = false): string | null => {
    const span = findQuote(index, value);
    if (!span) return null;
    let [start, end] = span;
    // A letters-and-digits match ends on a digit: a phone keeps the `+` or brackets written around it.
    if (keepSigns) {
      while (start > 0 && '+('.includes(located[start - 1] ?? '')) start--;
      if (located[end] === ')' && located.slice(start, end).includes('(')) end++;
    }
    return located.slice(start, end).replace(/\s+/g, ' ');
  };
  const text = (value: string) => fromSource(value) ?? '';
  const optional = (value: string | null) => (value === null ? null : fromSource(value));
  // Months are not checked: only the year has to be in the quote.
  const date = (value: string | null) =>
    value !== null && fromSource(value.slice(0, 4)) !== null ? value : null;

  switch (fact.kind) {
    case 'position': {
      const { company, title, location, start, end, current } = fact.position;
      const verifiedStart = date(start);
      const verifiedEnd = date(end);
      // A verified end date contradicts "current". It wins when its year differs from the start year; an
      // end equal to the start year may just be the start read twice, so both are dropped and the
      // incomplete dates become a question instead of one guess silently winning.
      const ambiguous =
        current && verifiedEnd !== null && verifiedEnd.slice(0, 4) === verifiedStart?.slice(0, 4);
      return {
        ...fact,
        position: {
          company: text(company),
          title: text(title),
          location: optional(location),
          start: verifiedStart,
          end: ambiguous ? null : verifiedEnd,
          current: current && verifiedEnd === null,
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
    case 'skill': {
      const name = fromSource(fact.skill.name);
      return name === null ? null : { ...fact, skill: { name } };
    }
    case 'contact': {
      const value = fromSource(fact.contact.value, fact.contact.field === 'phone');
      return value === null ? null : { ...fact, contact: { ...fact.contact, value } };
    }
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
