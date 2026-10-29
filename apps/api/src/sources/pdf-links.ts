// Loaded by the PDF worker (pdf-text.worker.ts) as well as by the tests: plain TypeScript that Node runs
// by stripping types, with no imports.

const SCHEME = /^(?:https?:\/\/|mailto:)/i;
/** Longer is a tracking or share link, not a contact; it would also make a huge pattern below. */
const MAX_LINK_CHARS = 2048;
/** Per document: a CV has a handful of contact links, and every line counts toward the source limit. */
const MAX_LINK_LINES = 20;

/** The links of a document seen so far, and how many lines they added. */
export interface SeenLinks {
  keys: Set<string>;
  added: number;
}

/** A link as a CV writes it: no scheme, `www.`, mail subject, trailing slash or spaces; lower case. */
function bare(link: string): string {
  return link
    .replace(/\s+/g, '')
    .replace(/^(mailto:[^?]*)\?.*$/i, '$1')
    .replace(SCHEME, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/**
 * Whether the text shows the link whole: with or without its scheme and `www.`, perhaps wrapped over
 * lines, and not as a part of a longer link (`t.me/ol` is not shown by `t.me/olena_h`, nor
 * `example.com` by `example.com/portfolio`) — the same reading as the contact check, with its blind
 * spots: a link glued to a hyphen before it or to a word after a full stop reads as not shown.
 */
function shows(text: string, link: string): boolean {
  const spaced = (link.match(/./gsu) ?? [])
    .map((char) => char.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'))
    .join('\\s*');
  return new RegExp(
    `(?<![\\w.@-])(?:(?:https?:\\/\\/|mailto:)\\s*)?(?:www\\.\\s*)?${spaced}\\/?(?![\\w-]|[./]\\w)`,
    'iu',
  ).test(text);
}

/**
 * The addresses of a page's links that its text does not show, one per line, to add to the text. A CV
 * made in a design tool often shows only a label ("LinkedIn", "Telegram") and keeps the address in the
 * link, where the models would never see it. Only web and mail links: those are what a label hides, and
 * a `tel:` written another way than the visible number would read as a second phone. `seen` spans the
 * document, so a link in a running header is added once. The lines are source text like any other, so a
 * contact taken from them goes through the usual exact check.
 */
export function linkLines(urls: readonly string[], pageText: string, seen: SeenLinks): string[] {
  const lines: string[] = [];
  for (const url of urls) {
    if (seen.added >= MAX_LINK_LINES) break;
    const key = bare(url);
    if (!SCHEME.test(url) || url.length > MAX_LINK_CHARS || key === '' || seen.keys.has(key))
      continue;
    seen.keys.add(key);
    if (shows(pageText, key)) continue;
    lines.push(url);
    seen.added++;
  }
  return lines;
}
