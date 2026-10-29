import type { CvDocument } from '@cv/shared';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderCvBody, renderCvHtml } from '../src/index.js';
import { loadEmbeddedFonts } from '../src/node.js';
import { enSample } from './fixtures/en-sample.js';
import { pdfText } from './pdf-text.js';

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

const names = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i}`,
    name: `${prefix} tool ${i + 1}`,
  }));

/** A CV whose skills are titled groups long enough to wrap. */
const document: CvDocument = {
  ...enSample,
  skills: [
    { id: 'k1', title: 'Machine learning', items: names('Model', 14) },
    { id: 'k2', title: 'Data platforms and pipelines', items: names('Pipeline', 9) },
  ],
};

describe('skill groups in the PDF layout (cv-template.md, TPL-10)', () => {
  it('starts each group’s skills on the line of its title and wraps them under it', async () => {
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
    await page.emulateMedia({ media: 'print' });
    await page.setContent(
      renderCvHtml(document, { fonts: { embedded: await loadEmbeddedFonts() } }),
    );
    const groups = await page.$$eval('.cv-skill-group', (elements) =>
      elements.map((element) => {
        const title = element.querySelector('.cv-skill-group__title')!.getBoundingClientRect();
        const skills = [...element.querySelectorAll('li')].map((li) => li.getBoundingClientRect());
        const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
        return {
          firstOnTitleLine: Math.abs(skills[0]!.top - title.top) < lineHeight / 2,
          // A skill breaks across lines only when it is wider than a whole line.
          skillsWhole: [...element.querySelectorAll('li')].every(
            (li) => li.getClientRects().length === 1,
          ),
          lines: Math.round(element.getBoundingClientRect().height / lineHeight),
        };
      }),
    );
    await page.close();
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expect(group.firstOnTitleLine).toBe(true);
      expect(group.skillsWhole).toBe(true);
      expect(group.lines).toBeGreaterThan(1);
    }
  });

  it('reads in the PDF text as the title, then its skills apart, across the wrapped lines', async () => {
    const text = await pdfText(browser, document);
    expect(text).toMatch(/Machine learning:\s+Model tool 1\s*·\s*Model tool 2\s*·\s*Model tool 3/);
    expect(text).toMatch(/Model tool 13\s*·\s*Model tool 14\s+Data platforms and pipelines:/);
  });

  it.each([
    ['Cloud: ', '>Cloud:</span>'],
    [':', null],
  ])(
    'prints one colon after the title %j, and no title when only colons are left',
    (title, printed) => {
      const body = renderCvBody({
        ...enSample,
        skills: [{ id: 'k1', title, items: names('Cloud', 2) }],
      });
      expect(body).not.toContain('::');
      if (printed) expect(body).toContain(printed);
      else expect(body).not.toContain('cv-skill-group__title');
    },
  );
});
