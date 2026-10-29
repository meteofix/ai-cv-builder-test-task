// Runs in a worker thread (see extract-pdf-text.ts). Node loads this file on its own, so it imports only
// `unpdf`, `node:` modules and the layout and links modules next to it (with the extension of this file,
// `.ts` under the tests and `.js` in `dist`), and uses no syntax that needs a compiler.
import { parentPort, workerData } from 'node:worker_threads';
import { getDocumentProxy } from 'unpdf';

const EXT = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
const { pageText } = (await import(
  new URL(`./pdf-layout.${EXT}`, import.meta.url).href
)) as typeof import('./pdf-layout.js');
const { linkLines } = (await import(
  new URL(`./pdf-links.${EXT}`, import.meta.url).href
)) as typeof import('./pdf-links.js');

/** PDF.js `VerbosityLevel.ERRORS`: no warnings. */
const PDFJS_ERRORS_ONLY = 0;

/** What the worker answers; `reason` is how the caller tells a protected file from a broken one. */
export type PdfTextResult =
  { ok: true; text: string } | { ok: false; reason: 'encrypted' | 'too_many_pages' | 'invalid' };

async function run(bytes: Uint8Array, maxPages: number): Promise<PdfTextResult> {
  let pdf;
  try {
    // Verbosity 0 (errors only): PDF.js warnings quote values from the file on stderr, which the API forwards
    // to its own log, and a log line must never carry the content of a CV.
    pdf = await getDocumentProxy(bytes, { verbosity: PDFJS_ERRORS_ONLY });
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error && error.name === 'PasswordException' ? 'encrypted' : 'invalid',
    };
  }
  // Counted before any text is read, so a huge document costs nothing.
  if (pdf.numPages > maxPages) return { ok: false, reason: 'too_many_pages' };
  const pages: string[] = [];
  const seenLinks = { keys: new Set<string>(), added: 0 };
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    const items = content.items.flatMap((item) =>
      'str' in item
        ? [
            {
              str: item.str,
              // PDF.js types the transform matrix loosely; x and y are its translation.
              x: Number(item.transform[4]),
              y: Number(item.transform[5]),
              width: item.width,
              height: item.height,
              hasEOL: item.hasEOL,
            },
          ]
        : [],
    );
    // Columns read one after another, a date column next to its entry (docs/specs/cvs.md).
    const text = pageText(items);
    // A page without a letter of its own gets no link lines: a scan with a clickable address is still a
    // scan (the same test as PDF_NO_TEXT).
    if (!/\p{L}/u.test(text)) {
      pages.push(text);
      continue;
    }
    // PDF.js sets `url` only for a link with a valid absolute address; internal links have none.
    const urls = (await page.getAnnotations()).flatMap((annotation: { url?: unknown }) =>
      typeof annotation.url === 'string' ? [annotation.url] : [],
    );
    pages.push([text, ...linkLines(urls, text, seenLinks)].join('\n'));
  }
  // Postgres refuses U+0000 in text, and extraction noise is the only way one gets here.
  return { ok: true, text: pages.join('\n').replaceAll('\u0000', '').trim() };
}

const { bytes, maxPages } = workerData as { bytes: Uint8Array; maxPages: number };
parentPort?.postMessage(await run(bytes, maxPages));
