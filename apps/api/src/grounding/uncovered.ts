import { normalizeText } from './normalize.js';
import { sourceLines, type SourceLine } from './instructions.js';

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
