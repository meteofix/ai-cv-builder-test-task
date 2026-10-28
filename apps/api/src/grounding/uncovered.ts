import { normalizeText } from './find-quote.js';
import { sourceLines } from './instructions.js';
import { overlaps, type Span } from './span.js';

const HAS_LETTER = /\p{L}/u;

/**
 * Source lines no span covers, so content the extractor skipped is shown instead of lost. The caller
 * passes the spans of the kept facts together with the instruction fragments. Lines without a letter and section headings are not content. A line repeated in the
 * source (a PDF footer on every page) counts as one and is covered when any copy is.
 */
export function uncoveredLines(
  source: string,
  spans: readonly Span[],
  sectionHeadings: readonly string[],
): string[] {
  const headings = new Set(sectionHeadings.map((heading) => normalizeText(heading).toLowerCase()));
  const covered = new Set<string>();
  const candidates: string[] = [];
  for (const { span, text } of sourceLines(source)) {
    const line = text.trim();
    if (!HAS_LETTER.test(line) || headings.has(normalizeText(line).toLowerCase())) continue;
    candidates.push(line);
    if (spans.some((covering) => overlaps(span, covering))) covered.add(line);
  }
  return [...new Set(candidates)].filter((line) => !covered.has(line));
}
