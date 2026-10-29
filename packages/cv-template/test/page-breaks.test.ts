import type { CvDocument, CvPosition } from '@cv/shared';
import { chromium, type Browser } from 'playwright';
import { getDocumentProxy } from 'unpdf';
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
