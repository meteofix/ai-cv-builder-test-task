import { findQuote, indexText, normalizeText } from './find-quote.js';
import { overlaps, type Span } from './span.js';

/**
 * The whole list of instruction patterns (docs/specs/grounding.md, §3). Each one needs an explicit
 * injection marker next to its verb, so ordinary developer language ("override default rules", "wrote
 * system prompts") does not match.
 */
const INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /\b(ignore|disregard|forget|override)\s+(?:\w+\s+){0,2}?(previous|prior|above|earlier|all|any|your|these)\s+(?:\w+\s+){0,2}?(instructions?|prompts?)\b/i,
  /\b(ignore|disregard|forget|override)\s+(?:\w+\s+){0,2}?(previous|prior|above|earlier|your|these)\s+(?:\w+\s+){0,2}?(rules|guidelines)\b/i,
  /\b(new|updated|real|actual|hidden|secret)\s+(system|developer)\s+(prompt|message|instructions?)\b/i,
  /^\s*(system|developer)(\s+(prompt|message))?\s*:/i,
  /\byou\s+(are|must|should|will)\s+now\b/i,
  /\b(add|include|insert|list|mention|put)\b[^\n]{0,60}\bas\s+(my|the|an?)\s+(employer|company|job|position|title|role|degree|school|university)\b/i,
  /\b(respond|reply|answer|output|return)\s+only\s+(with|in|as)\s+(json|yaml|xml)\b/i,
  /\b(respond|reply|answer)\s+with\s+the\s+following\b/i,
  /<\/?\s*(cv_source|system|assistant|user|instructions?)\s*>/i,
];

export interface SourceLine {
  span: Span;
  /** The line without its line break, untrimmed. */
  text: string;
}

// PDF text can break lines with a lone `\r`, a form feed between pages or a Unicode separator; an injected
// line must not hide inside the line before it.
const LINE_BREAK = /\r\n|[\n\r\f\v\u2028\u2029]/g;

/** Lines of the source with their offsets. */
export function sourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  for (const match of source.matchAll(LINE_BREAK)) {
    lines.push({ span: [start, match.index], text: source.slice(start, match.index) });
    start = match.index + match[0].length;
  }
  lines.push({ span: [start, source.length], text: source.slice(start) });
  return lines;
}

/**
 * Spans of the source lines that look like instructions to the model: lines matching a pattern (after
 * level-1 normalization, so full-width or typographic look-alikes match too) and lines holding a quote
 * from the extractor's `ignoredInstructions`.
 */
export function instructionFragments(
  source: string,
  ignoredInstructions: readonly string[],
): Span[] {
  const index = indexText(source);
  const ignored = ignoredInstructions
    .map((quote) => findQuote(index, quote))
    .filter((span) => span !== null);
  return sourceLines(source)
    .filter(
      ({ span, text }) =>
        span[0] < span[1] &&
        (INSTRUCTION_PATTERNS.some((pattern) => pattern.test(normalizeText(text))) ||
          ignored.some((quote) => overlaps(span, quote))),
    )
    .map(({ span }) => span);
}
