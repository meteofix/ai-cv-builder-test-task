import type { CvDocument, CvPosition } from '@cv/shared';
import { chromium, type Browser } from 'playwright';
import { extractText, getDocumentProxy } from 'unpdf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderCvShell } from '../src/index.js';
import { loadEmbeddedFonts } from '../src/node.js';
import { PAGE_CONTENT_HEIGHT_PX } from '../src/page.js';
import { pdfPages, printPdf } from './pdf-text.js';

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

/**
 * A bullet of about four lines, numbered so every one is unique in the PDF text. Four lines can split
 * two and two even with Chromium's default orphans and widows, so a missing `break-inside` shows.
 */
const bullet = (n: number) =>
  `Item ${n}: reworked the nightly settlement batch so that late card files from the two acquiring banks no longer block the morning reconciliation report, moved the retry logic into the job queue, added alerts on stuck files and wrote the runbook the support shift now follows, for the finance team.`;

let counter = 0;
const bullets = (count: number) =>
  Array.from({ length: count }, () => {
    counter += 1;
    return { id: `b${counter}`, text: bullet(counter), factIds: [] };
  });

const job = (
  id: string,
  company: string,
  title: string,
  start: string,
  end: string | null,
  groups: CvPosition['groups'],
): CvPosition => ({ id, company, title, start, end, current: end === null, groups });

const cv = (experience: CvPosition[]): CvDocument => ({
  locale: 'en',
  contacts: { fullName: 'Marta Hrytsenko', email: '', phone: '', location: '', links: [] },
  headline: 'Backend Engineer',
  summary: { text: 'Backend engineer working on payment systems.', factIds: [] },
  experience,
  education: [],
  skills: [],
  additional: [],
});

describe('page breaks of the PDF (cv-template.md, behaviour 10)', () => {
  it('starts a company block that does not fit the rest of page 1 on page 1, not on a new page', async () => {
    // Page 1 is half full before the block; the block is shorter than a page, so an unbreakable block
    // would move whole to page 2 and leave half of page 1 empty.
    const pages = await pdfPages(
      browser,
      cv([
        job('a', 'Quellstone Bank', 'Senior Engineer', '2022-02', null, [
          { id: 'ga', title: null, items: bullets(4) },
        ]),
        job('b', 'Kestrel Payments', 'Lead Engineer', '2020-01', '2022-01', [
          { id: 'gb', title: 'Settlement', items: bullets(5) },
        ]),
        job('c', 'Kestrel Payments', 'Engineer', '2017-05', '2019-12', [
          { id: 'gc', title: 'Ledger', items: bullets(5) },
        ]),
      ]),
    );

    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatch(/Kestrel Payments.*Lead Engineer.*Settlement Item 5:/);
    // Page 2 starts inside the Kestrel block, so it names the company first.
    expect(pages[1]).toMatch(/^Kestrel Payments — continued /);
  }, 60_000);

  it('names the company in the CV’s language at the top of a page that starts inside its job', async () => {
    const pages = await pdfPages(browser, {
      ...cv([
        job('a', 'Quellstone Bank', 'Senior Engineer', '2022-02', null, [
          { id: 'ga', title: null, items: bullets(14) },
        ]),
      ]),
      locale: 'uk',
    });
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[1]).toMatch(/^Quellstone Bank — продовження Item/);
  }, 60_000);

  // The filler shifts where the pages break, so across the cases every kind of heading comes near a
  // page end at least once.
  it.each([0, 1, 2, 3, 4, 5, 6, 7])(
    'ends every page with a whole bullet, never a heading (filler of %i bullets)',
    async (filler) => {
      const experience = [
        job('f', 'Quellstone Bank', 'Senior Engineer', '2022-02', null, [
          { id: 'gf', title: null, items: bullets(1 + filler) },
        ]),
        ...[1, 2, 3, 4].flatMap((n) => [
          job(`r${n}`, `Company ${n}`, `Role ${n}A`, `201${n}-01`, `201${n}-06`, [
            { id: `g${n}a`, title: `Area ${n}A`, items: bullets(2) },
            { id: `g${n}b`, title: `Area ${n}B`, items: bullets(2) },
          ]),
          job(`s${n}`, `Company ${n}`, `Role ${n}B`, `201${n}-07`, `201${n}-12`, [
            { id: `g${n}c`, title: `Area ${n}C`, items: bullets(3) },
          ]),
          // Only the first position has bullets: they are the company's and follow its last title.
          job(`t${n}`, `Company ${n + 4}`, `Role ${n}C`, `201${n}-01`, `201${n}-06`, [
            { id: `g${n}d`, title: null, items: bullets(2) },
          ]),
          job(`u${n}`, `Company ${n + 4}`, `Role ${n}D`, `201${n}-07`, `201${n}-12`, []),
        ]),
      ];
      const pages = await pdfPages(browser, cv(experience));

      expect(pages.length).toBeGreaterThan(1);
      // A page that starts inside a job says whose job it is; one that starts with a new job does not.
      pages.slice(1).forEach((page, index) => {
        const continued = /^(Company \d|Quellstone Bank) — continued /.exec(page);
        const fresh = /^(Company \d|Quellstone Bank) [A-Z][a-z]{2} \d{4}/.test(page);
        expect(Boolean(continued) || fresh, `page ${index + 2}: ${page.slice(0, 60)}`).toBe(true);
      });
      pages.slice(0, -1).forEach((page, index) => {
        // A page that ends with a bullet ends with its full stop; any heading, company line or date ends otherwise.
        expect(page, `page ${index + 1} ends with a line of a bullet`).toMatch(/finance team\.$/);
      });
    },
    60_000,
  );

  describe('a CV whose jobs and records have no lines', () => {
    // A job without bullets ends with its company line and a record without lines is its title alone;
    // a break after such a last line is fine, so it must not pull the break back to the section title.
    const titled = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, n) => ({
        id: `${prefix}${n}`,
        title: `${prefix} record ${n + 1}`,
        start: `20${10 + n}-01`,
        end: null,
        groups: [],
      }));
    /** Six jobs without bullets, `count` certificates and `count` achievements, then one interest. */
    const titledCv = (count: number): CvDocument => ({
      ...cv(
        [1, 2, 3, 4, 5, 6].map((n) =>
          job(`j${n}`, `Company ${n}`, `Role ${n}`, `201${n}-01`, `201${n}-12`, []),
        ),
      ),
      education: [
        { id: 'e1', institution: 'Kyiv Polytechnic Institute', degree: 'MSc, Computer Science' },
      ],
      additional: [
        { id: 'cert', title: 'Certifications', entries: titled('Certificate', count) },
        { id: 'ach', title: 'Achievements', entries: titled('Achievement', count) },
        {
          id: 'int',
          title: 'Interests',
          entries: [
            {
              id: 'i1',
              title: '',
              start: null,
              end: null,
              groups: [
                { id: 'gi', title: null, items: [{ id: 'l1', text: 'Chess', factIds: [] }] },
              ],
            },
          ],
        },
      ],
    });

    it('moves only the last section when the CV is slightly longer than a page', async () => {
      // The exact reported case, so it is tied to the page height: with 4 records each only Interests
      // passes the page, with 6 each two achievements follow it; re-tune the count when the page metrics
      // change. The next case carries the intent alone.
      const pages = await pdfPages(browser, titledCv(4));

      expect(pages).toHaveLength(2);
      expect(pages[0]).toMatch(/ Summary .* Experience Role 1 .* Company 1 /i);
      expect(pages[0]).toMatch(/Achievement record 4 Jan 2013$/);
      expect(pages[1]).toBe('INTERESTS Chess');
    }, 60_000);

    it('keeps the experience section on page 1 when the records run onto page 2', async () => {
      const pages = await pdfPages(browser, titledCv(10));

      expect(pages.length).toBeGreaterThan(1);
      expect(pages[0]).toMatch(/ Summary .* Experience Role 1 .* Company 1 /i);
      expect(pages.at(-1)).toMatch(/INTERESTS Chess$/);
    }, 60_000);
  });

  // 120 lines kept together fill about three pages. Short timeouts: a loop that never ends fails as a
  // timeout instead of hanging the run.
  describe('a chain of blocks kept together that is longer than a page', () => {
    const line = (n: number) => `<p style="break-after:avoid">Kept line ${n}</p>`;
    const printed = async (body: string) => {
      const shell = renderCvShell({ fonts: { embedded: await loadEmbeddedFonts() } });
      const html = shell.replace('<body></body>', `<body><main class="cv">${body}</main></body>`);
      const pdf = await getDocumentProxy(await printPdf(browser, html));
      return (await extractText(pdf, { mergePages: false })).text.map((page) => page.trim());
    };

    it('ends inside a job, and every page fits', async () => {
      // Each break in a job adds a "continued" line above the page's first block; a break before that
      // block again would start the same page over and over.
      const kept = Array.from({ length: 120 }, (_, n) => line(n + 1)).join('');
      const pages = await printed(
        `<article class="cv-entry" data-continued="Acme — continued"><p>Opening line</p>${kept}<p>Last line</p></article>`,
      );

      expect(pages.length).toBeGreaterThan(1);
      expect(pages.length).toBeLessThanOrEqual(4);
      // Every page starts where `paginate` broke it: no page was too long, so Chromium broke none itself.
      pages.slice(1).forEach((page, index) => {
        expect(page, `page ${index + 2}`).toMatch(/^Acme — continued\s+Kept line \d+/);
      });
      expect(pages.at(-1)).toMatch(/Last line$/);
    }, 15_000);

    it('breaks where it overflows outside a job, before the whole of a block kept whole', async () => {
      // Without a "continued" line a break one block below the page start would still progress, a
      // block a page. The lines come in blocks of five that avoid breaks inside.
      const blocks = Array.from(
        { length: 24 },
        (_, b) =>
          `<div style="break-inside:avoid">${[1, 2, 3, 4, 5].map((n) => line(b * 5 + n)).join('')}</div>`,
      ).join('');
      const pages = await printed(`<p>Opening line</p>${blocks}<p>Last line</p>`);

      expect(pages.length).toBeGreaterThan(1);
      expect(pages.length).toBeLessThanOrEqual(4);
      pages.slice(1).forEach((page, index) => {
        const first = /^Kept line (\d+)/.exec(page);
        expect(first, `page ${index + 2}: ${page.slice(0, 30)}`).not.toBeNull();
        expect(Number(first?.[1]) % 5, `page ${index + 2} starts a block`).toBe(1);
      });
      expect(pages.at(-1)).toMatch(/Last line$/);
    }, 15_000);
  });
});

describe('PAGE_CONTENT_HEIGHT_PX', () => {
  const pagesFor = async (height: number) => {
    const shell = renderCvShell({ fonts: { embedded: await loadEmbeddedFonts() } });
    const html = shell.replace(
      '<body></body>',
      `<body><main class="cv"><div style="height:${height}px"></div></main></body>`,
    );
    return (await getDocumentProxy(await printPdf(browser, html))).numPages;
  };

  it('is the printable height of one PDF page', async () => {
    expect(await pagesFor(Math.floor(PAGE_CONTENT_HEIGHT_PX) - 1)).toBe(1);
    expect(await pagesFor(Math.ceil(PAGE_CONTENT_HEIGHT_PX) + 1)).toBe(2);
  }, 60_000);
});
