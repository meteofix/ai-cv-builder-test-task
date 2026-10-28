import type { CvDocument } from '@cv/shared';
import { chromium, type Browser } from 'playwright';
import { getDocumentProxy } from 'unpdf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDF_OPTIONS, renderCvHtml } from '../src/index.js';
import { loadEmbeddedFonts } from '../src/node.js';

const cv: CvDocument = {
  locale: 'en',
  contacts: {
    fullName: 'Iryna Kovalenko',
    email: 'iryna@example.com',
    phone: '',
    location: 'Kyiv',
    links: [],
  },
  headline: 'Senior Full-Stack Engineer',
  summary: { text: 'Full-stack engineer.', factIds: [] },
  experience: [],
  education: [],
  skills: [{ id: 's1', name: 'TypeScript' }],
  additional: [],
};

const MM_TO_PT = 72 / 25.4;

describe('PDF_OPTIONS', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser.close();
  });

  it('keeps the frozen options of the PDF endpoint and the ATS test', () => {
    expect(PDF_OPTIONS).toEqual({ format: 'A4', printBackground: true, tagged: true });
  });

  it('prints A4 with the 17 mm page margin from the template CSS', async () => {
    const page = await browser.newPage();
    await page.setContent(renderCvHtml(cv, { fonts: { embedded: await loadEmbeddedFonts() } }));
    await page.evaluate(() => document.fonts.ready);
    const pdf = new Uint8Array(await page.pdf(PDF_OPTIONS));

    const first = await (await getDocumentProxy(pdf)).getPage(1);
    const [, , width, height] = first.view as [number, number, number, number];
    // Chromium rounds the page box to whole CSS pixels, hence the one-point tolerance.
    expect(Math.abs(width - 210 * MM_TO_PT)).toBeLessThan(1);
    expect(Math.abs(height - 297 * MM_TO_PT)).toBeLessThan(1);

    const { items } = await first.getTextContent();
    const left = Math.min(
      ...items.flatMap((item) => ('transform' in item ? [item.transform[4] as number] : [])),
    );
    expect(Math.abs(left - 17 * MM_TO_PT)).toBeLessThan(1.5);
  });
});
