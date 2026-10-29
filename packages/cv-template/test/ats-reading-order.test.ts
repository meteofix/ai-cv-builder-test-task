import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LABELS } from '../src/index.js';
import { enSample } from './fixtures/en-sample.js';
import { ukSample } from './fixtures/uk-sample.js';
import { pdfText } from './pdf-text.js';

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

/** Finds `needle` at or after `from` and fails the test when it is missing. */
function find(text: string, needle: string, from: number): number {
  const at = text.indexOf(needle, from);
  expect(at, `"${needle}" after offset ${from}`).toBeGreaterThanOrEqual(from);
  return at;
}

// A regression test for docs/specs/cv-template.md, behaviour 1, kept outside the acceptance examples.
// Chromium paints positioned boxes after the normal flow, so a positioned bullet puts its text at the end
// of the PDF content stream: an applicant tracking system then reads every bullet after the last section.
describe('reading order of the PDF (cv-template.md, behaviour 1)', () => {
  it.each([
    ['en', enSample],
    ['uk', ukSample],
  ] as const)(
    '%s: every bullet follows its position title and comes before the next one',
    async (locale, sample) => {
      const text = await pdfText(browser, sample);
      // The headline and the summary can repeat a position title, so the search starts at the section title.
      let from = find(text, LABELS[locale].experience.toLocaleUpperCase(locale), 0);
      const titles = sample.experience.map((position) => {
        const at = find(text, position.title, from);
        from = at + position.title.length;
        return at;
      });
      titles.push(find(text, LABELS[locale].education.toLocaleUpperCase(locale), from));
      sample.experience.forEach((position, index) => {
        for (const bullet of position.bullets) {
          const at = find(text, bullet.text.slice(0, 40), 0);
          expect(at, `${bullet.id} after its position`).toBeGreaterThan(titles[index]!);
          expect(at, `${bullet.id} before the next position`).toBeLessThan(titles[index + 1]!);
        }
      });
    },
    60_000,
  );
});
