import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bulletsOf, experienceGroups } from '@cv/shared';
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
      // A company's shared bullets (only its first position has any) follow its last title (behaviour 5a).
      let index = 0;
      for (const group of experienceGroups(sample.experience)) {
        const shared = group.length > 1 && group.slice(1).every((p) => bulletsOf(p).length === 0);
        group.forEach((position, i) => {
          const after = titles[shared ? index + group.length - 1 : index + i]!;
          const before = titles[shared ? index + group.length : index + i + 1]!;
          for (const bullet of bulletsOf(position)) {
            const at = find(text, bullet.text.slice(0, 40), 0);
            expect(at, `${bullet.id} after its position`).toBeGreaterThan(after);
            expect(at, `${bullet.id} before the next position`).toBeLessThan(before);
          }
        });
        index += group.length;
      }
    },
    60_000,
  );
});

describe('a company with several positions in the PDF (cv-template.md, behaviour 5a)', () => {
  it('reads the company, then each title with its dates, then the shared bullets', async () => {
    const text = await pdfText(browser, enSample);
    let from = find(text, 'Example Labs', find(text, 'EXPERIENCE', 0));
    for (const part of [
      'QA Engineer',
      'Oct 2018 – May 2019',
      'QA Intern',
      'Jul 2018 – Sep 2018',
      'Wrote and maintained manual test cases',
    ]) {
      from = find(text, part, from) + part.length;
    }
    // The company is printed once.
    expect(text.indexOf('Example Labs', text.indexOf('Example Labs') + 1)).toBe(-1);
  }, 60_000);
});
