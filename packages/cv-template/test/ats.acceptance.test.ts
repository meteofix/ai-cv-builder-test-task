import type { CvDocument } from '@cv/shared';
import { chromium, type Browser } from 'playwright';
import { extractText, getDocumentProxy } from 'unpdf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDF_OPTIONS, renderCvHtml } from '../src/index.js';
import { loadEmbeddedFonts } from '../src/node.js';
import { enSample } from './fixtures/en-sample.js';
import { ukSample } from './fixtures/uk-sample.js';

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

/** Prints the CV exactly as the PDF endpoint does and reads the text back, as an applicant tracking system would. */
async function pdfText(document: CvDocument): Promise<string> {
  const html = renderCvHtml(document, { fonts: { embedded: await loadEmbeddedFonts() } });
  const page = await browser.newPage();
  try {
    await page.setContent(html);
    // An expression string: it runs in the page, and a string needs no types for the page's globals.
    await page.evaluate('document.fonts.ready.then(() => undefined)');
    const pdf = await page.pdf(PDF_OPTIONS);
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(pdf)), {
      mergePages: true,
    });
    return text.replace(/\s+/g, ' ');
  } finally {
    await page.close();
  }
}

const TITLES = {
  en: [
    'Summary',
    'Experience',
    'Education',
    'Skills',
    'Certifications',
    'Languages',
    'Volunteering',
  ],
  uk: ['Про мене', 'Досвід роботи', 'Освіта', 'Навички'],
} as const;

/** What each position of the samples prints as its dates; the freelance position has none. */
const PRINTED_DATES = {
  en: [
    'Mar 2023 – Present',
    'Jan 2021 – Feb 2023',
    'Jun 2019 – Dec 2020',
    null,
    'Jul 2018 – Sep 2018',
  ],
  uk: ['вер 2022 – дотепер'],
} as const;

describe('ATS readability of the PDF', () => {
  it.each([
    ['en', enSample],
    ['uk', ukSample],
  ] as const)(
    'TPL-6 — %s: whole-word titles, section order, dates by their positions',
    async (locale, sample) => {
      const text = await pdfText(sample);

      // The titles are printed in capitals (CSS `text-transform`), and each is searched after the previous
      // one: "experience" also occurs in the summary, so a plain search could find the wrong place.
      // A letter-spaced title would extract as "E X P E R I E N C E" and not be found at all.
      const at: number[] = [];
      let from = 0;
      for (const title of TITLES[locale]) {
        const found = text.indexOf(title.toLocaleUpperCase(locale), from);
        expect(
          found,
          `title ${title} as one word, after the previous section`,
        ).toBeGreaterThanOrEqual(from);
        at.push(found);
        from = found + title.length;
      }

      // Each position's dates sit after its title and before the next position's title.
      // The headline repeats the first title, so the search starts at the "Experience" heading.
      const starts: number[] = [];
      from = at[1] ?? 0;
      for (const position of sample.experience) {
        const found = text.indexOf(position.title, from);
        expect(found).toBeGreaterThanOrEqual(from);
        starts.push(found);
        from = found + position.title.length;
      }
      sample.experience.forEach((_position, index) => {
        const slice = text.slice(starts[index], starts[index + 1] ?? at[2]);
        const dates = PRINTED_DATES[locale][index];
        if (dates) expect(slice).toContain(dates);
      });
    },
    60_000,
  );
});
