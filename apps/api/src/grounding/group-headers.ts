import type { ExtractedFact } from './facts.js';
import { findQuote, matchQuote, normalizeText, type QuoteIndex } from './find-quote.js';
import { sourceLines } from './instructions.js';
import { overlaps, type Span } from './span.js';

const LETTER = /\p{L}/u;
const LINE_BREAKS = /\r\n|[\n\r\f\v\u2028\u2029]/g;
const LINE_BREAK = /[\n\r\f\v\u2028\u2029]/;
/** A company name may wrap once or twice in a narrow column; a longer passage is not a company line. */
const MAX_HEADER_LINES = 3;

interface Located {
  fact: ExtractedFact;
  span: Span;
}

interface Anchored extends Located {
  header: Span | null;
  anchor: number;
}

/**
 * Where each position's company is written when the extractor quoted it apart from the title, such as a
 * company line above several positions (docs/specs/grounding.md §2). A header counts only as source text
 * that is the position's own line or stands before it (the nearest such occurrence), holds no other fact,
 * no other position and no instruction, and has nothing of another company starting between it and the
 * position — neither another header nor a position under another header. It may wrap over at most three
 * lines (a long company name in a narrow column). Otherwise the company is checked in the position's own
 * quote, as any other value is.
 */
export function groupHeaders(
  source: string,
  index: QuoteIndex,
  found: readonly Located[],
  instructionSpans: readonly Span[],
  sectionHeadings: readonly string[] = [],
): Map<ExtractedFact, Span> {
  const others = found.filter(({ fact }) => fact.kind !== 'position').map(({ span }) => span);
  const lines = (span: Span) =>
    (source.slice(span[0], span[1]).match(LINE_BREAKS)?.length ?? 0) + 1;
  // A header holds no other fact and no instruction; a position may only share it as its own line (the
  // span object of the position being checked).
  const usable = (header: Span, position: Span, company: string) =>
    lines(header) <= MAX_HEADER_LINES &&
    wrapsOnlyTheName(source.slice(header[0], header[1]), company) &&
    ![...others, ...instructionSpans].some((span) => overlaps(span, header)) &&
    !found.some(
      ({ fact, span }) => fact.kind === 'position' && span !== position && overlaps(span, header),
    );

  const positions = found.flatMap(({ fact, span }): Anchored[] => {
    if (fact.kind !== 'position') return [];
    const quote = fact.position.companyQuote;
    const header =
      quote === undefined
        ? null
        : nearestHeader(index, quote, span, (h) => usable(h, span, fact.position.company));
    // Where the position's company starts in the source: its header line, or the position itself.
    return [{ fact, span, header, anchor: (header ?? span)[0] }];
  });
  // The text line right above the position must belong to the block (a position or a bullet under that
  // header), be the first line after the header (a duration or a place) or a heading. Anything else —
  // another employer nobody extracted, a line another fact quotes — may be a boundary, so the company is
  // checked in the position's own quote instead.
  const headingSet = new Set(
    sectionHeadings.map((heading) => normalizeText(heading).toLowerCase()),
  );
  const allLines = sourceLines(source);
  const unexplainedBetween = (header: Span, position: Span): boolean => {
    const block = new Set(
      positions.filter((other) => other.header?.[0] === header[0]).map((other) => other.fact.id),
    );
    const own = found
      .filter(
        ({ fact }) =>
          block.has(fact.id) ||
          (fact.kind === 'achievement' && block.has(fact.achievement.positionId ?? '')),
      )
      .map(({ span }) => span);
    const between = allLines.filter(
      ({ span, text }) => span[0] >= header[1] && span[1] <= position[0] && LETTER.test(text),
    );
    // Only the text line right above the position decides: a job nobody extracted stands right above
    // its title, while a location or a dropped bullet of an earlier title of the block does not.
    const above = between.at(-1);
    if (!above || above === between[0]) return false;
    if (headingSet.has(normalizeText(above.text).toLowerCase())) return false;
    return !own.some((covering) => overlaps(covering, above.span));
  };
  const headers = new Map<ExtractedFact, Span>();
  for (const position of positions) {
    const { header } = position;
    if (header === null) continue;
    const foreignBetween = positions.some(
      (other) =>
        other.header?.[0] !== header[0] &&
        other.anchor > header[0] &&
        other.anchor < position.span[0],
    );
    if (!foreignBetween && !unexplainedBetween(header, position.span)) {
      headers.set(position.fact, header);
    }
  }
  return headers;
}

/**
 * A header over several lines holds a wrapped name: the company starts on its first line and ends on its
 * last, so no other line (a second company, a job nobody extracted) can hide in it.
 */
function wrapsOnlyTheName(header: string, company: string): boolean {
  if (!LINE_BREAK.test(header)) return true;
  const match = findQuote(header, company);
  return (
    match !== null &&
    !LINE_BREAK.test(header.slice(0, match[0])) &&
    !LINE_BREAK.test(header.slice(match[1]))
  );
}

/** The occurrence on the position's own line, else the last one that ends before the position starts. */
function nearestHeader(
  index: QuoteIndex,
  quote: string,
  position: Span,
  usable: (span: Span) => boolean,
): Span | null {
  const candidates: Span[] = [];
  // Rejecting every occurrence makes the search visit all of them at both levels.
  matchQuote(index, quote, (span) => {
    if (usable(span)) candidates.push(span);
    return null;
  });
  const inside = candidates.find((span) => span[0] >= position[0] && span[1] <= position[1]);
  if (inside) return inside;
  const before = candidates.filter((span) => span[1] <= position[0]);
  return before.sort((a, b) => b[0] - a[0])[0] ?? null;
}
