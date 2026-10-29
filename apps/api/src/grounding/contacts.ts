/**
 * Contacts are the one thing code checks against the source (docs/specs/grounding.md §7): a wrong email,
 * phone or link cannot be caught by reading, and it costs the person a job. A value the source does not
 * contain whole is dropped and the editor asks for it instead.
 */

const SCHEME = /^(https?:\/\/|mailto:|tel:)/i;

const escape = (char: string) => char.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * The characters of a value with any whitespace allowed between them: PDF text often breaks a long email
 * or link over two lines ("linkedin.com/in/" / "name-123").
 */
const spaced = (value: string) => (value.match(/./gsu) ?? []).map(escape).join('\\s*');

/** The email without whitespace, when the source contains it whole (case-insensitively); otherwise null. */
export function checkEmail(value: string, source: string): string | null {
  const email = value.replace(/\s+/g, '');
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) return null;
  // Not part of a longer address: no address character before it, no more domain after it.
  return new RegExp(`(?<![\\w.+-])${spaced(email)}(?![\\w-]|\\.\\w)`, 'iu').test(source)
    ? email
    : null;
}

/**
 * The phone as the source writes it, when the model's digits stand there as one number — spaced, dashed
 * or bracketed any way, across at most one line break (a PDF wraps a long contact line) — and not as part
 * of a longer one.
 */
export function checkPhone(value: string, source: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7) return null;
  // Inside the number a line break may stand; at its edges only spaces on the same line, so a phone on
  // the line above a line of dates is not "part of a longer number".
  const inside = '[\\s().\\-–—]*';
  const edge = '(?:[^\\S\\r\\n\\f\\v]|[().\\-–—])*';
  const pattern = new RegExp(
    `(?<!\\d${edge})(?:\\+${edge})?${(digits.match(/\d/g) ?? []).join(inside)}(?!${edge}\\d)`,
    'gu',
  );
  const match = [...source.matchAll(pattern)].find(
    (found) => (found[0].match(/\r\n|[\n\r\f\v]/g) ?? []).length <= 1,
  );
  // The source's own text, on one line: the model's copy could carry words around the digits.
  return match ? match[0].replace(/\s+/g, ' ').trim() : null;
}

/**
 * The link, joined without whitespace, with a scheme the template accepts (http(s), mailto or tel), when
 * the source contains it whole — with or without its scheme and `www.`, case-insensitively, not a prefix
 * of a longer link; otherwise null.
 */
export function checkLink(value: string, source: string): string | null {
  const link = value.replace(/\s+/g, '');
  const bare = bareLink(link);
  if (bare.length < 4) return null;
  // Before it: a scheme or `www.` may stand, a longer host or an email's `@` may not; after it: a slash
  // may, more of the path may not.
  const pattern = new RegExp(
    `(?<![\\w.@-])(?:(?:https?:\\/\\/|mailto:|tel:)\\s*)?(?:www\\.\\s*)?${spaced(bare)}\\/?(?![\\w-]|[./]\\w)`,
    'iu',
  );
  if (!pattern.test(source)) return null;
  const withScheme = SCHEME.test(link) ? link : `https://${link}`;
  return URL.canParse(withScheme) &&
    ['http:', 'https:', 'mailto:', 'tel:'].includes(new URL(withScheme).protocol)
    ? withScheme
    : null;
}

function bareLink(link: string): string {
  return link
    .replace(SCHEME, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '');
}
