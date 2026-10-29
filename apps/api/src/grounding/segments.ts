import { isInstruction, sourceLines } from './instructions.js';
import type { Span } from './span.js';

/**
 * One addressable piece of the source (docs/specs/grounding.md §2): a line, or a sentence of a long
 * line. The author and the reviewer cite segments by id, and the accounting of what reached the CV
 * counts them, so a paragraph from which one sentence was used does not hide the rest.
 */
export interface Segment {
  /** `S1…Sn` in source order; answers to questions are `A1…`. */
  id: string;
  /** Trimmed. */
  text: string;
  span: Span;
  /** Looks like an instruction to the model: never shown to a model, listed as ignored. */
  instruction: boolean;
}

/** A line longer than this is split into sentences; a pasted text without line breaks is one long line. */
export const MAX_LINE_CHARS = 200;

// ICU's sentence rules are not language-specific for Latin and Cyrillic; one segmenter serves en and uk.
const sentences = new Intl.Segmenter('en', { granularity: 'sentence' });

export function segmentSource(source: string): Segment[] {
  const pieces: Span[] = [];
  for (const { span, text } of sourceLines(source)) {
    if (text.trim().length <= MAX_LINE_CHARS) {
      pieces.push(span);
      continue;
    }
    for (const sentence of sentences.segment(text)) {
      const start = span[0] + sentence.index;
      pieces.push([start, start + sentence.segment.length]);
    }
  }
  const segments: Segment[] = [];
  for (const piece of pieces) {
    const span = trimSpan(source, piece);
    if (span[0] === span[1]) continue;
    const text = source.slice(span[0], span[1]);
    segments.push({
      id: `S${segments.length + 1}`,
      text,
      span,
      instruction: isInstruction(text),
    });
  }
  // An instruction a PDF wrapped over two or three lines ("Ignore all" / "previous" / "instructions…")
  // matches only when they are read together: then every one of them is cut.
  for (const size of [2, 3]) {
    segments.forEach((_, i) => {
      const run = segments.slice(i, i + size);
      if (run.length < size || run.some((segment) => segment.instruction)) return;
      if (isInstruction(run.map((segment) => segment.text).join(' '))) {
        for (const segment of run) segment.instruction = true;
      }
    });
  }
  return segments;
}

function trimSpan(source: string, [start, end]: Span): Span {
  let from = start;
  let to = end;
  while (from < to && /\s/u.test(source[from] ?? '')) from++;
  while (to > from && /\s/u.test(source[to - 1] ?? '')) to--;
  return [from, to];
}
