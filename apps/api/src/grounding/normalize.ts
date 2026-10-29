const QUOTES: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '“': '"',
  '”': '"',
  '„': '"',
};
const DASHES: ReadonlySet<string> = new Set(['‐', '‑', '‒', '–', '—', '―', '−']);
// Grapheme clusters keep a base letter with its combining marks, so NFKC composes them as one unit.
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

/**
 * Level-1 normalization, for comparing lines and headings and for matching instruction patterns on
 * look-alike characters: NFKC, typographic quotes and dashes to ASCII, whitespace runs to one space,
 * trimmed.
 */
export function normalizeText(text: string): string {
  let out = '';
  for (const { segment } of graphemes.segment(text)) {
    for (const char of segment.normalize('NFKC'))
      out += QUOTES[char] ?? (DASHES.has(char) ? '-' : char);
  }
  return out.replace(/\s+/gu, ' ').trim();
}
