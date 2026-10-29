import { readFile } from 'node:fs/promises';
import { extractText, getDocumentProxy } from 'unpdf';
import { describe, expect, it, test } from 'vitest';
import { extractPdfText } from './extract-pdf-text.js';
import { pageText, streamText, type PdfTextItem } from './pdf-layout.js';

/** A run of text at (x, y) from the top-left, 10 pt, 6 pt per character. */
function at(str: string, x: number, top: number, size = 10): PdfTextItem {
  return { str, x, y: 800 - top, width: str.length * 6, height: size, hasEOL: false };
}

const lines = (text: string) => text.split('\n');

describe('pageText', () => {
  it('reads two columns one after the other, below a full-width header, even row-aligned', () => {
    const left = ['Skills', 'Go, SQL', 'Kafka', 'Languages', 'Ukrainian', 'English'];
    const right = [
      'Experience',
      'Acme Corp, Engineer',
      'Shipped the billing service',
      'Led the migration',
    ];
    const column = (texts: string[], x: number, count: number) =>
      Array.from({ length: count }, (_, i) => at(texts[i % texts.length] ?? '', x, 60 + 15 * i));
    const items = [
      at('Iryna Kovalenko — Senior Engineer — iryna@example.com — Kyiv', 40, 20),
      ...column(left, 40, 14),
      ...column(right, 250, 14),
    ];
    const text = lines(pageText(items));
    expect(text[0]).toBe('Iryna Kovalenko — Senior Engineer — iryna@example.com — Kyiv');
    expect(text.slice(1, 15)).toEqual(column(left, 40, 14).map((item) => item.str));
    expect(text.slice(15)).toEqual(column(right, 250, 14).map((item) => item.str));
  });

  it('attaches a narrow column of places and dates on the right to the entry line it starts at', () => {
    const items = [
      at('Acme Corp, Senior Engineer', 40, 20),
      at('Kyiv', 400, 20),
      at('Built the billing service that handles payouts', 50, 35),
      at('2021 – present', 400, 35),
      at('for twelve markets', 50, 50),
      at('Shipped a fraud check', 50, 65),
      at('Globex, Engineer', 40, 95),
      at('Lviv', 400, 95),
      at('Wrote the export tool', 50, 110),
      at('2018 – 2021', 400, 110),
      at('Ran the release train', 50, 125),
    ];
    expect(lines(pageText(items))).toEqual([
      'Acme Corp, Senior Engineer  Kyiv  2021 – present',
      'Built the billing service that handles payouts',
      'for twelve markets',
      'Shipped a fraud check',
      'Globex, Engineer  Lviv  2018 – 2021',
      'Wrote the export tool',
      'Ran the release train',
    ]);
  });

  it('puts a column of dates on the left before the entry line', () => {
    const items = [
      at('2021–2024', 40, 20),
      at('Senior Engineer, Acme Corp', 150, 20),
      at('Built the billing service', 150, 35),
      at('Ran the on-call rotation', 150, 50),
      at('2018–2021', 40, 80),
      at('Engineer, Globex', 150, 80),
      at('Wrote the export tool', 150, 95),
      at('Shipped a fraud check', 150, 110),
    ];
    expect(lines(pageText(items))).toEqual([
      '2021–2024  Senior Engineer, Acme Corp',
      'Built the billing service',
      'Ran the on-call rotation',
      '2018–2021  Engineer, Globex',
      'Wrote the export tool',
      'Shipped a fraud check',
    ]);
  });

  it('keeps rows aligned on both sides together, as a table', () => {
    const items = [
      at('2014', 40, 20),
      at('First place, regional contest', 120, 20),
      at('2013', 40, 35),
      at('Finalist, national olympiad', 120, 35),
      at('2012', 40, 50),
      at('Second place, city hackathon', 120, 50),
    ];
    expect(lines(pageText(items))).toEqual([
      '2014  First place, regional contest',
      '2013  Finalist, national olympiad',
      '2012  Second place, city hackathon',
    ]);
  });

  it('keeps the content stream order of a page without columns', () => {
    const items: PdfTextItem[] = [
      { ...at('Second line', 40, 35), hasEOL: true },
      { ...at('First line', 40, 20), hasEOL: true },
    ];
    expect(pageText(items)).toBe(streamText(items));
    expect(streamText(items)).toBe('Second line\nFirst line\n');
  });

  it('reads a superscript with its line', () => {
    const items = [
      at('2014', 40, 20),
      at('1', 120, 20),
      { ...at('st', 126, 15, 6), width: 8 },
      at('/50', 134, 20),
      at('2013', 40, 35),
      at('7', 120, 35),
      { ...at('th', 126, 30, 6), width: 8 },
      at('/120', 134, 35),
      at('Skills', 300, 60),
      at('Go', 300, 75),
      at('Notes', 40, 60),
      at('More notes', 40, 75),
    ];
    expect(lines(pageText(items)).slice(0, 2)).toEqual(['2014  1st/50', '2013  7th/120']);
  });
});

describe('pageText on hard pages', () => {
  const words = (text: string) => text.split(/\s+/).filter(Boolean).sort();

  it('keeps every run when a side block starts above every main line', () => {
    const items = [
      at('Kyiv', 400, 20),
      at('Acme Corp, Senior Engineer', 40, 35),
      at('2021 – 2024', 400, 35),
      at('Built the billing service for payouts', 50, 50),
      at('3 years', 400, 50),
      at('Shipped a fraud check', 50, 65),
      at('Remote', 400, 65),
      at('Ran the release train', 50, 80),
      at('Wrote the export tool', 50, 95),
      at('Mentored two interns', 50, 110),
      at('Moved the build to a cache', 50, 125),
    ];
    const text = pageText(items);
    expect(words(text)).toEqual(words(items.map((item) => item.str).join(' ')));
    expect(lines(text).slice(0, 2)).toEqual([
      'Kyiv',
      'Acme Corp, Senior Engineer  2021 – 2024  3 years  Remote',
    ]);
  });

  it('reads a sidebar on the same line grid as two columns, not as a column of dates', () => {
    const side = Array.from({ length: 8 }, (_, i) => at(`Skill ${i + 1}`, 40, 20 + 15 * i));
    const main = Array.from({ length: 20 }, (_, i) =>
      at(`Main line number ${i + 1} of the CV`, 200, 20 + 15 * i),
    );
    const text = lines(pageText([...side, ...main]));
    expect(text).toEqual([...side, ...main].map((item) => item.str));
  });

  it('keeps a long list whose markers are runs of their own as rows', () => {
    const items = Array.from({ length: 15 }, (_, i) => [
      { ...at('•', 40, 20 + 15 * i), width: 4 },
      at(`Achievement number ${i + 1}`, 60, 20 + 15 * i),
    ]).flat();
    expect(lines(pageText(items))[0]).toBe('•  Achievement number 1');
  });

  it('rejects a strip that more rows cross than the limit, even when no point is covered twice', () => {
    // The columns end at 150 and start at 300; the three rows fill the strip between them end to end.
    const rows = Array.from({ length: 20 }, (_, i) => [
      { ...at(`Left ${i}`, 40, 20 + 15 * i), width: 110 },
      at(`Right ${i}`, 300, 20 + 15 * i),
    ]).flat();
    // Three rows reach into the strip between the columns, each into a different part of it.
    const intruders = [
      { ...at('a', 150, 400), width: 50 },
      { ...at('b', 200, 415), width: 50 },
      { ...at('c', 250, 430), width: 50 },
    ];
    const items = [...rows, ...intruders];
    expect(pageText(items)).toBe(streamText(items));
  });

  test.each([
    [
      'more runs than any CV page has',
      // Two columns of 26 one-letter runs per row, 101 rows: laid out, it would be read column by column.
      Array.from({ length: 101 }, (_, row) =>
        Array.from({ length: 52 }, (_, i) =>
          at('w', i < 26 ? 40 + 7 * i : 300 + 7 * (i - 26), 15 * row),
        ),
      ).flat(),
    ],
    [
      'more rows than any CV page has',
      Array.from({ length: 501 }, (_, i) => at(`Row ${i}`, i % 2 ? 300 : 40, 15 * i)),
    ],
    [
      'a run far outside any page',
      [at('Left', 40, 20), at('Left', 40, 35), at('Right', 300, 20), at('Far', 1e6, 35)],
    ],
  ])('keeps the stream order for %s', (_name, items) => {
    expect(pageText(items)).toBe(streamText(items));
  });
});

const fixture = (name: string) => new URL(`../../test/sources/layout/${name}`, import.meta.url);

async function textOf(name: string): Promise<string[]> {
  const result = await extractPdfText(new Uint8Array(await readFile(fixture(name))), {
    maxPages: 10,
    timeoutMs: 20_000,
  });
  if (!result.ok) throw new Error(`fixture ${name} could not be read`);
  return lines(result.text);
}

/** The lines from `first` to `last`, which must appear in this order and next to each other. */
function block(text: string[], first: string, last: string): string[] {
  const from = text.findIndex((line) => line.startsWith(first));
  const to = text.findIndex((line, i) => i >= from && line.startsWith(last));
  return from === -1 || to === -1 ? [] : text.slice(from, to + 1);
}

describe('PDF text with layout (invented fixtures rendered by Chromium)', () => {
  it('gives the sample CV exactly the text it had without layout', async () => {
    const bytes = new Uint8Array(
      await readFile(new URL('../../../../examples/sample-cv.pdf', import.meta.url)),
    );
    const { text } = await extractText(await getDocumentProxy(bytes.slice(), { verbosity: 0 }));
    const result = await extractPdfText(bytes, { maxPages: 10, timeoutMs: 20_000 });
    expect(result).toEqual({ ok: true, text: text.join('\n').trim() });
  });

  it('reads a sidebar before the main column and keeps page 2 headings above their bullets', async () => {
    const text = await textOf('sidebar-group.pdf');
    expect(block(text, 'Batch and streaming', 'English — C1').length).toBeGreaterThan(5);
    expect(text.indexOf('English — C1')).toBeLessThan(text.indexOf('Olena Marchenko'));
    expect(text).toContain('Data Engineering Lead  Jan 2024 — Jun 2025');
    const continued = text.findIndex((line) => line.startsWith('Data platform'));
    const later = text.findIndex(
      (line, i) => i > continued && line.startsWith('Data platform cont.'),
    );
    expect(text[later + 1]).toMatch(/^- Cut the monthly warehouse bill/);
  });

  it('attaches a right-hand column of place, dates and duration to its entry line', async () => {
    const text = await textOf('dates-right.pdf');
    expect(text).toContain(
      'Tidewater Robotics, Head of Platform Engineering  Hamburg, Germany  Apr 2021 – present  4 years 7 months',
    );
    expect(
      text.some((line) => line.startsWith('Built the fleet') && line.includes('present')),
    ).toBe(false);
  });

  it('reads a full-width header band first, then each column', async () => {
    const text = await textOf('banded-two-column.pdf');
    expect(text.indexOf('Priya Raman')).toBeLessThan(text.indexOf('EDUCATION'));
    expect(text.indexOf('Kotlin • Swift • Haskell')).toBeLessThan(text.indexOf('EXPERIENCE'));
    expect(text).toContain('2020  1st/80  University Hackathon, Lakeside');
  });

  test.each([
    ['linkedin-modern.pdf', 'Contact', 'Service Design Fundamentals', 'Mateusz Wrona'],
    ['uk-two-column.pdf', 'Тарас Гнатюк', "Бакалавр, комп'ютерні науки · 2013 – 2017", 'КОНТАКТИ'],
  ])('%s: one column is read whole before the other', async (name, first, last, next) => {
    const text = await textOf(name);
    const column = block(text, first, last);
    expect(column.length).toBeGreaterThan(5);
    expect(text[text.indexOf(column.at(-1) ?? '') + 1]).toBe(next);
  });
});
