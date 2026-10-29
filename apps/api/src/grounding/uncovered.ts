import { normalizeText } from './find-quote.js';
import { sourceLines, type SourceLine } from './instructions.js';
import { overlaps, type Span } from './span.js';

const HAS_LETTER = /\p{L}/u;

/** Source lines that carry content: with a letter, and not a section heading the extractor returned. */
function contentSourceLines(source: string, sectionHeadings: readonly string[]): SourceLine[] {
  const headings = new Set(sectionHeadings.map((heading) => normalizeText(heading).toLowerCase()));
  return sourceLines(source).filter(({ text }) => {
    const line = text.trim();
    return HAS_LETTER.test(line) && !headings.has(normalizeText(line).toLowerCase());
  });
}

/** The content lines of the source, each text once (trimmed, in source order). */
export function contentLines(source: string, sectionHeadings: readonly string[]): string[] {
  return [...new Set(contentSourceLines(source, sectionHeadings).map(({ text }) => text.trim()))];
}

/**
 * Source lines no span covers, so content the extractor skipped is shown instead of lost. The caller
 * passes the spans of the kept facts together with the instruction fragments. Lines without a letter
 * and section headings are not content. A line repeated in the source (a PDF footer on every page)
 * counts as one and is covered when any copy is.
 */
export function uncoveredLines(
  source: string,
  spans: readonly Span[],
  sectionHeadings: readonly string[],
): string[] {
  const covered = new Set<string>();
  for (const { span, text } of contentSourceLines(source, sectionHeadings)) {
    if (spans.some((covering) => overlaps(span, covering))) covered.add(text.trim());
  }
  return contentLines(source, sectionHeadings).filter((line) => !covered.has(line));
}
