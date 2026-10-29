import { readFile } from 'node:fs/promises';
import { describe, expect, it, test } from 'vitest';
import { checkLink } from '../grounding/contacts.js';
import { extractPdfText } from './extract-pdf-text.js';
import { linkLines, type SeenLinks } from './pdf-links.js';

const fresh = (): SeenLinks => ({ keys: new Set(), added: 0 });

describe('linkLines', () => {
  const page = [
    'Olena Hrytsenko',
    'Telegram LinkedIn',
    'linkedin.com/in/olena-h',
    'olena@example.com',
    'example.com/a+b(c)?x=1',
  ].join('\n');

  test.each([
    ['a link behind a label', 'https://t.me/olena_h', ['https://t.me/olena_h']],
    ['a link the page shows without scheme and www', 'https://www.linkedin.com/in/olena-h/', []],
    ['a mail link to the shown email', 'mailto:olena@example.com', []],
    ['a mail link with a subject to the shown email', 'mailto:olena@example.com?subject=CV', []],
    [
      'a mail link to an address the page does not show',
      'mailto:hr@example.com',
      ['mailto:hr@example.com'],
    ],
    ['a phone link', 'tel:+380501112233', []],
    ['a link of another scheme', 'ftp://files.example.com/cv', []],
    [
      'a link the page shows only a longer form of',
      'https://linkedin.com/in/olena',
      ['https://linkedin.com/in/olena'],
    ],
    ['a site whose page the CV shows', 'https://linkedin.com', ['https://linkedin.com']],
    ['a shown link with pattern characters', 'https://example.com/a+b(c)?x=1', []],
    [
      'a link the pattern characters must not match',
      'https://example.com/aab(c)ax=1',
      ['https://example.com/aab(c)ax=1'],
    ],
    ['a link too long to be a contact', `https://example.com/${'a'.repeat(5000)}`, []],
  ])('%s', (_, url, expected) => {
    expect(linkLines([url], page, fresh())).toEqual(expected);
  });

  it('gives an address once, however many links carry it', () => {
    expect(linkLines(['https://t.me/olena_h', 'https://t.me/olena_h/'], page, fresh())).toEqual([
      'https://t.me/olena_h',
    ]);
  });

  it('gives an address once across pages, as a link in a running header', () => {
    const seen = fresh();
    expect(linkLines(['https://t.me/olena_h'], 'Page 1', seen)).toEqual(['https://t.me/olena_h']);
    expect(linkLines(['https://t.me/olena_h'], 'Page 2', seen)).toEqual([]);
  });

  it('adds at most 20 lines to a document', () => {
    const seen = fresh();
    const urls = (from: number) =>
      Array.from({ length: 15 }, (_, i) => `https://t.me/u${from + i}`);
    expect(linkLines(urls(0), 'Page 1', seen)).toHaveLength(15);
    expect(linkLines(urls(15), 'Page 2', seen)).toHaveLength(5);
  });

  it('sees a shown link a narrow column wrapped over two lines', () => {
    expect(
      linkLines(['https://github.com/olena-h-dev'], 'github.com/olena-\nh-dev', fresh()),
    ).toEqual([]);
  });
});

const fixtureText = async (name: string) => {
  const bytes = await readFile(new URL(`../../test/sources/layout/${name}`, import.meta.url));
  const result = await extractPdfText(new Uint8Array(bytes), { maxPages: 10, timeoutMs: 20_000 });
  if (!result.ok) throw new Error(`fixture ${name} could not be read`);
  return result.text;
};

describe('PDF text with the addresses of labelled links (invented fixtures rendered by Chromium)', () => {
  it('adds every address a label hides, once, and nothing the page already shows', async () => {
    const text = await fixtureText('hidden-links.pdf');
    const lines = text.split('\n');
    const links = lines.filter((line) => /^(?:https?|mailto|tel):/.test(line));
    expect(links).toEqual([
      'https://t.me/ilona_v_design',
      'https://www.linkedin.com/in/ilona-verbytska-example/',
      'https://www.example-portfolio.net/ilonav',
    ]);
    expect(lines).toContain('Telegram');
    expect(lines.filter((line) => line.includes('github.com/ilona-v-example'))).toHaveLength(1);
    // The contact check reads them like any other line of the source.
    expect(checkLink('linkedin.com/in/ilona-verbytska-example', text)).toBe(
      'https://linkedin.com/in/ilona-verbytska-example',
    );
  });

  it('adds nothing to a page without text, so a scan with a clickable address stays a scan', async () => {
    // No letter at all is what PDF_NO_TEXT refuses (docs/specs/cvs.md).
    expect(await fixtureText('scan-with-link.pdf')).not.toMatch(/\p{L}/u);
  });
});
