import type { Span } from './span.js';

/**
 * A normalized form of a text with, for every UTF-16 unit of `text`, the `[start, end)` range of the
 * original text it came from, so a match in the normalized text maps back to the original.
 */
interface Indexed {
  text: string;
  starts: number[];
  ends: number[];
}

/** Both normalization levels of one text; build it once for a source that many quotes are searched in. */
export interface QuoteIndex {
  original: string;
  level1: Indexed;
  level2: Indexed;
}

const QUOTES: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '“': '"',
  '”': '"',
  '„': '"',
};
const DASHES = new Set(['‐', '‑', '‒', '–', '—', '―', '−']);
const WHITESPACE = /^\s$/u;
const LETTER_OR_DIGIT = /^[\p{L}\p{N}]$/u;
const LETTER = /^\p{L}$/u;
// Grapheme clusters keep a base letter with its combining marks, so NFKC composes them as one unit.
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

export function indexText(original: string): QuoteIndex {
  const level1 = normalizeLevel1(original);
  return { original, level1, level2: keepLettersAndDigits(level1) };
}

/**
 * The span of `quote` in `source`, or null. Level 1 compares normalized texts, level 2 only letters and
 * digits; at both levels a match must not cut a token of the original text. No fuzzy matching.
 */
export function findQuote(source: string | QuoteIndex, quote: string): Span | null {
  return matchQuote(source, quote)?.span ?? null;
}

/** Like `findQuote`, and says which level matched: 2 means only the letters and digits are equal. */
export function matchQuote(
  source: string | QuoteIndex,
  quote: string,
): { span: Span; level: 1 | 2 } | null {
  const index = typeof source === 'string' ? indexText(source) : source;
  const needle = indexText(quote);
  const exact = firstWholeTokenMatch(index, index.level1, needle.level1.text);
  if (exact) return { span: exact, level: 1 };
  const loose = firstWholeTokenMatch(index, index.level2, needle.level2.text);
  return loose ? { span: loose, level: 2 } : null;
}

/** NFKC, typographic quotes and dashes to ASCII, whitespace runs to one space, trimmed. */
function normalizeLevel1(original: string): Indexed {
  const out: Indexed = { text: '', starts: [], ends: [] };
  let pendingSpace: { start: number; end: number } | null = null;
  for (const { segment, index } of graphemes.segment(original)) {
    const end = index + segment.length;
    for (const char of segment.normalize('NFKC')) {
      const mapped = QUOTES[char] ?? (DASHES.has(char) ? '-' : char);
      if (WHITESPACE.test(mapped)) {
        // Leading whitespace is dropped; trailing whitespace is never flushed.
        if (out.text !== '') {
          pendingSpace ??= { start: index, end };
          pendingSpace.end = end;
        }
        continue;
      }
      if (pendingSpace) {
        push(out, ' ', pendingSpace.start, pendingSpace.end);
        pendingSpace = null;
      }
      push(out, mapped, index, end);
    }
  }
  return out;
}

/**
 * Lower-cased letters and digits, plus a `+` or `#` that directly follows a letter or another such sign,
 * so `C++` and `C#` stay whole instead of collapsing into `c`.
 */
function keepLettersAndDigits(level1: Indexed): Indexed {
  const out: Indexed = { text: '', starts: [], ends: [] };
  let previous = '';
  let previousKeptSign = false;
  for (let i = 0; i < level1.text.length;) {
    const codePoint = level1.text.codePointAt(i) ?? 0;
    const char = String.fromCodePoint(codePoint);
    const start = level1.starts[i] ?? 0;
    const end = level1.ends[i + char.length - 1] ?? start;
    let keptSign = false;
    if (LETTER_OR_DIGIT.test(char)) {
      for (const lower of char.toLowerCase()) {
        if (LETTER_OR_DIGIT.test(lower)) push(out, lower, start, end);
      }
    } else if ((char === '+' || char === '#') && (LETTER.test(previous) || previousKeptSign)) {
      push(out, char, start, end);
      keptSign = true;
    }
    previous = char;
    previousKeptSign = keptSign;
    i += char.length;
  }
  return out;
}

function push(out: Indexed, chars: string, start: number, end: number): void {
  out.text += chars;
  // One entry per UTF-16 unit, so an astral character gets its range twice.
  out.starts.push(...new Array<number>(chars.length).fill(start));
  out.ends.push(...new Array<number>(chars.length).fill(end));
}

function firstWholeTokenMatch(index: QuoteIndex, level: Indexed, needle: string): Span | null {
  if (needle === '') return null;
  for (let at = level.text.indexOf(needle); at !== -1; at = level.text.indexOf(needle, at + 1)) {
    const start = level.starts[at];
    const end = level.ends[at + needle.length - 1];
    if (start === undefined || end === undefined) continue;
    if (!cutsToken(index.original, start) && !cutsToken(index.original, end)) return [start, end];
  }
  return null;
}

/** True when the position lies between two characters of one token (`Java|Script`, `C|++`). */
function cutsToken(text: string, position: number): boolean {
  return (
    position > 0 &&
    position < text.length &&
    isTokenChar(text, position - 1) &&
    isTokenChar(text, position)
  );
}

/** A letter or digit, or a `+`/`#` that directly follows a letter or another such sign. */
function isTokenChar(text: string, at: number): boolean {
  const char = text[at] ?? '';
  if (LETTER_OR_DIGIT.test(char)) return true;
  if (char !== '+' && char !== '#') return false;
  const before = text[at - 1] ?? '';
  return LETTER.test(before) || ((before === '+' || before === '#') && isTokenChar(text, at - 1));
}

/** Level-1 normalization of a short text, for comparing lines and headings. */
export function normalizeText(text: string): string {
  return normalizeLevel1(text).text;
}
