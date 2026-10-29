import type { CvDocument } from '@cv/shared';
import type { Browser } from 'playwright';
import { extractText, getDocumentProxy } from 'unpdf';
import { PDF_OPTIONS, renderCvHtml } from '../src/index.js';
import { loadEmbeddedFonts, placePageBreaks } from '../src/node.js';

/** Prints a page exactly as the PDF endpoint does. */
export async function printPdf(browser: Browser, html: string): Promise<Uint8Array> {
  const page = await browser.newPage();
  try {
    await page.setContent(html);
    // An expression string: it runs in the page, and a string needs no types for the page's globals.
    await page.evaluate('document.fonts.ready.then(() => undefined)');
    await placePageBreaks(page);
    return new Uint8Array(await page.pdf(PDF_OPTIONS));
  } finally {
    await page.close();
  }
}

/** The text of each page of the CV's PDF, as an applicant tracking system would read it. */
export async function pdfPages(browser: Browser, document: CvDocument): Promise<string[]> {
  const html = renderCvHtml(document, { fonts: { embedded: await loadEmbeddedFonts() } });
  const { text } = await extractText(await getDocumentProxy(await printPdf(browser, html)), {
    mergePages: false,
  });
  return text.map((page) => page.replace(/\s+/g, ' ').trim());
}

/** Prints the CV exactly as the PDF endpoint does and reads the text back, as an applicant tracking system would. */
export async function pdfText(browser: Browser, document: CvDocument): Promise<string> {
  return (await pdfPages(browser, document)).join(' ');
}
