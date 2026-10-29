import type { DroppedFact, DropReason, ExtractedFact, Fact } from './facts.js';
import { findQuote, indexText, normalizeText } from './find-quote.js';
import { sourceLines } from './instructions.js';
import { groupHeaders } from './group-headers.js';
import { checkValues } from './fact-values.js';
import { overlaps, type Span } from './span.js';

export interface VerifiedFacts {
  /** Kept facts, renumbered `f1…fn` in source order. */
  facts: Fact[];
  dropped: DroppedFact[];
  /** Group lines a kept position's company was checked in: covered like the facts' own quotes. */
  headers: Span[];
  /** Achievements moved to another position because theirs was not kept, and those left without one. */
  reattached: number;
  unplaced: number;
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
  sectionHeadings: readonly string[] = [],
): VerifiedFacts {
  const index = indexText(source);
  const dropped: DroppedFact[] = [];
  const drop = (fact: ExtractedFact, reason: DropReason) =>
    dropped.push({ id: fact.id, kind: fact.kind, reason });

  const seen = new Set<string>();
  const found: { fact: ExtractedFact; span: Span }[] = [];
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
    found.push({ fact, span });
  }

  const companySpans = groupHeaders(source, index, found, instructionSpans);
  const located: Fact[] = [];
  const seenFacts = new Set<string>();
  for (const { fact, span } of found) {
    const sourceText = source.slice(span[0], span[1]);
    const checked = checkValues(fact, source, span, companySpans.get(fact));
    if (!checked) {
      drop(fact, 'field_not_in_quote');
      continue;
    }
    // A second pass or a repair may quote what an earlier fact already stands for.
    const identity = sameness(checked, span);
    const positionAt = `position|${span[0]}|${span[1]}`;
    const hollow = checked.kind === 'position' && checked.position.title === '';
    if (seenFacts.has(identity) || (hollow && seenFacts.has(positionAt))) {
      drop(fact, 'duplicate');
      continue;
    }
    seenFacts.add(identity);
    if (checked.kind === 'position') seenFacts.add(positionAt);
    // The stored quote is the source's text, so nothing downstream (the writer included) sees the model's copy.
    located.push({ ...checked, quote: sourceText.replace(/\s+/g, ' ').trim(), span });
  }

  // Achievements are resolved last: their position may come later in the model's list.
  const headingSpans = headingLines(source, sectionHeadings);
  const {
    facts: kept,
    reattached,
    unplaced,
  } = placeAchievements(
    // Facts that won their id first: their group is the one the id stands for.
    [...found.map(({ fact }) => fact), ...extracted],
    located,
    headingSpans,
  );
  const keptPositions = new Set(kept.filter((fact) => fact.kind === 'position').map((f) => f.id));
  const headers = [...companySpans]
    .filter(([fact]) => keptPositions.has(fact.id))
    .map(([, span]) => span);
  return { facts: renumber(kept), dropped, headers, reattached, unplaced };
}

/**
 * An achievement whose position was not kept (its quote failed, or the model named no real position)
 * is not dropped with it (grounding.md §2). It goes to the first kept position of the same group (where
 * the group's shared bullets live), else to the nearest kept position at or above it in the source —
 * where the judge looks for the position a quote stands under — unless a section heading lies between
 * them: a bullet of another section (projects, volunteering) is not a duty of the job above it. The
 * heading guard is for that fallback only: the group is the model's own grouping by employer. Without a
 * target it keeps no position and is shown as not used.
 */
function placeAchievements(
  extracted: readonly ExtractedFact[],
  located: Fact[],
  headings: readonly Span[],
) {
  const positions = located
    .filter((fact) => fact.kind === 'position')
    .sort((a, b) => a.span[0] - b.span[0]);
  const kept = new Set(positions.map((fact) => fact.id));
  const groupOf = new Map<string, string>();
  for (const fact of extracted) {
    if (fact.kind === 'position' && fact.position.companyQuote !== undefined) {
      if (!groupOf.has(fact.id)) groupOf.set(fact.id, fact.position.companyQuote);
    }
  }
  let reattached = 0;
  let unplaced = 0;
  const facts = located.map((fact): Fact => {
    if (fact.kind !== 'achievement') return fact;
    const own = fact.achievement.positionId;
    if (own !== null && kept.has(own)) return fact;
    const group = own === null ? undefined : groupOf.get(own);
    const above = positions.filter((position) => position.span[0] <= fact.span[0]).at(-1);
    const sameSection =
      above !== undefined &&
      !headings.some((heading) => heading[0] >= above.span[1] && heading[1] <= fact.span[0]);
    const target =
      (group === undefined ? undefined : positions.find((p) => groupOf.get(p.id) === group)) ??
      (sameSection ? above : undefined);
    if (target) reattached++;
    else unplaced++;
    return { ...fact, achievement: { positionId: target?.id ?? null } };
  });
  return { facts, reattached, unplaced };
}

/** Lines of the source that equal a section heading (level-1 normalization, any case). */
function headingLines(source: string, sectionHeadings: readonly string[]): Span[] {
  const headings = new Set(sectionHeadings.map((heading) => normalizeText(heading).toLowerCase()));
  return sourceLines(source)
    .filter(({ text }) => headings.has(normalizeText(text).toLowerCase()))
    .map(({ span }) => span);
}

/**
 * Two facts are the same when they share the kind, the span and every value: one line may list several
 * skills, or two degrees of one school. A position whose title was cleared shares the identity of any
 * position at its span: it is a copy that lost its values, not another job.
 */
function sameness(fact: ExtractedFact, span: Span): string {
  const values =
    fact.kind === 'skill'
      ? [fact.skill.name]
      : fact.kind === 'contact'
        ? [fact.contact.field, fact.contact.value]
        : fact.kind === 'position'
          ? [fact.position.title, fact.position.start, fact.position.end]
          : fact.kind === 'education'
            ? [
                fact.education.institution,
                fact.education.degree,
                fact.education.start,
                fact.education.end,
              ]
            : [];
  return [
    fact.kind,
    span[0],
    span[1],
    ...values.map((value) => normalizeText(value ?? '').toLowerCase()),
  ].join('|');
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
    const own = fact.achievement.positionId;
    const positionId = own === null ? null : (ids.get(own) ?? own);
    return { ...fact, id, achievement: { positionId } };
  });
}
