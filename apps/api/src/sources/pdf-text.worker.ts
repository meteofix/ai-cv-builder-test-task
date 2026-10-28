// Runs in a worker thread (see extract-pdf-text.ts). Self-contained on purpose: Node loads this file on its
// own, so it imports only `unpdf` and `node:` modules and uses no syntax that needs a compiler.
import { parentPort, workerData } from 'node:worker_threads';
import { extractText, getDocumentProxy } from 'unpdf';

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
  const { text } = await extractText(pdf);
  // Postgres refuses U+0000 in text, and extraction noise is the only way one gets here.
  return { ok: true, text: text.join('\n').replaceAll('\u0000', '').trim() };
}

const { bytes, maxPages } = workerData as { bytes: Uint8Array; maxPages: number };
parentPort?.postMessage(await run(bytes, maxPages));
