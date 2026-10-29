import type { CvDocument } from '@cv/shared';
import type { Browser } from 'playwright';
import { extractText, getDocumentProxy } from 'unpdf';
import { PDF_OPTIONS, renderCvHtml } from '../src/index.js';
import { loadEmbeddedFonts } from '../src/node.js';

/** Prints the CV exactly as the PDF endpoint does and reads the text back, as an applicant tracking system would. */
export async function pdfText(browser: Browser, document: CvDocument): Promise<string> {
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
