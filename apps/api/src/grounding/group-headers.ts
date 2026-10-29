import type { ExtractedFact } from './facts.js';
import { matchQuote, type QuoteIndex } from './find-quote.js';
import { overlaps, type Span } from './span.js';

const LINE_BREAK = /[\n\r\f\v\u2028\u2029]/;

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
 * company line above several positions (docs/specs/grounding.md §2). A header counts only as one line of
 * the source that is the position's own line or stands before it (the nearest such occurrence), holds no
 * other fact and no instruction, and has nothing of another company starting between it and the
 * position — neither another header nor a position under another header. Otherwise the company is
 * checked in the position's own quote, as any other value is.
 */
export function groupHeaders(
  source: string,
  index: QuoteIndex,
  found: readonly Located[],
  instructionSpans: readonly Span[],
): Map<ExtractedFact, Span> {
  const others = found.filter(({ fact }) => fact.kind !== 'position').map(({ span }) => span);
  const usable = (header: Span) =>
    !LINE_BREAK.test(source.slice(header[0], header[1])) &&
    ![...others, ...instructionSpans].some((span) => overlaps(span, header));

  const positions = found.flatMap(({ fact, span }): Anchored[] => {
    if (fact.kind !== 'position') return [];
    const quote = fact.position.companyQuote;
    const header = quote === undefined ? null : nearestHeader(index, quote, span, usable);
    // Where the position's company starts in the source: its header line, or the position itself.
    return [{ fact, span, header, anchor: (header ?? span)[0] }];
  });
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
    if (!foreignBetween) headers.set(position.fact, header);
  }
  return headers;
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
