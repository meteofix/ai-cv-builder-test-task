/**
 * Contacts are the one thing code checks against the source (docs/specs/grounding.md §3): a wrong email,
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
 * of a longer link — with the letters as the source writes them; otherwise null.
 */
export function checkLink(value: string, source: string): string | null {
  const link = value.replace(/\s+/g, '');
  // A stylized handle such as `Site://name` has a scheme of its own: it is not a link.
  if (/^[a-z][\w+.-]*:\/\//i.test(link) && !SCHEME.test(link)) return null;
  const bare = bareLink(link);
  if (bare.length < 4) return null;
  // Before it: a scheme or `www.` may stand, a longer host or an email's `@` may not; after it: a slash
  // may, more of the path may not.
  const pattern = new RegExp(
    `(?<![\\w.@-])(?:(?:https?:\\/\\/|mailto:|tel:)\\s*)?(?:www\\.\\s*)?(${spaced(bare)})\\/?(?![\\w-]|[./]\\w)`,
    'iu',
  );
  const found = pattern.exec(source)?.[1];
  if (found === undefined) return null;
  // Matched case-insensitively, but a path can be case-sensitive: the link keeps the source's letters.
  const at = link.length - link.replace(SCHEME, '').replace(/^www\./i, '').length;
  const written = `${link.slice(0, at)}${found.replace(/\s+/g, '')}${link.slice(at + bare.length)}`;
  const withScheme = SCHEME.test(written) ? written : `https://${written}`;
  if (!URL.canParse(withScheme)) return null;
  const url = new URL(withScheme);
  if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) return null;
  // A handle written "Telegram@name" or "Telegram: @name" parses as a user before a host with no dot:
  // it names an account, not a web address.
  const web = url.protocol === 'http:' || url.protocol === 'https:';
  if (web && (url.username !== '' || url.password !== '' || !url.hostname.includes('.')))
    return null;
  return withScheme;
}

// "Telegram @name", "Telegram: @name", "TG @name", "Telegram handle: name" (also "Телеграм"): only a label
// naming Telegram tells which service a bare handle belongs to, and a colon, a dash or "@" must follow it,
// so a word that merely starts with "tg" or follows "Telegram" is no handle. Telegram usernames are 5–32 letters, digits or "_".
const TELEGRAM =
  /^(?:telegram|телеграм|tg)(?:\s+handle)?(?:\s*[:\-–—]\s*@?|\s*@)([a-z0-9_]{5,32})$/iu;

/**
 * A handle the source labels as Telegram, as its `https://t.me/` link; null for any other handle or a
 * value the source does not hold as written (label and handle together).
 */
export function telegramLink(value: string, source: string): string | null {
  const handle = TELEGRAM.exec(value.trim())?.[1];
  return handle !== undefined && inSource(value, source) ? `https://t.me/${handle}` : null;
}

/**
 * Whether the source holds the value as written, any whitespace allowed between its characters, and not
 * as part of a longer word: "@ann_k77" is not in "@ann_k778".
 */
export function inSource(value: string, source: string): boolean {
  const compact = value.replace(/\s+/g, '');
  const edge = '[\\p{L}\\p{N}_-]';
  return (
    compact !== '' && new RegExp(`(?<!${edge})${spaced(compact)}(?!${edge})`, 'iu').test(source)
  );
}

function bareLink(link: string): string {
  return link
    .replace(SCHEME, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '');
}
