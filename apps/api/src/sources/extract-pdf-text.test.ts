import { describe, expect, it, vi } from 'vitest';
import { pdfWithFilter } from '../../test/sources/pdf-with-filter.js';
import { extractPdfText } from './extract-pdf-text.js';

const STDIO_SETTLE_MS = 300;

const fixture = (name: string) => new URL(`../../test/sources/${name}`, import.meta.url);

describe('extractPdfText', () => {
  it('gives up on a worker that never answers, within its timeout', async () => {
    const started = Date.now();
    const result = await extractPdfText(new Uint8Array(), {
      maxPages: 10,
      timeoutMs: 300,
      workerUrl: fixture('hang.worker.mjs'),
    });
    expect(result).toMatchObject({ ok: false, reason: 'invalid', cause: 'timeout' });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('treats a crashing worker as an unreadable file', async () => {
    const result = await extractPdfText(new Uint8Array(), {
      maxPages: 10,
      timeoutMs: 5000,
      workerUrl: fixture('crash.worker.mjs'),
    });
    expect(result).toMatchObject({
      ok: false,
      reason: 'invalid',
      cause: 'worker_error',
      errorName: 'Error',
    });
  });

  describe('process output', () => {
    /** Runs `work` and returns everything written to stdout and stderr meanwhile, workers' stdio included. */
    async function captureOutput(work: () => Promise<unknown>): Promise<string> {
      const written: string[] = [];
      const capture = (chunk: string | Uint8Array) => {
        written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
        return true;
      };
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(capture);
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(capture);
      try {
        await work();
        // A worker's stdio reaches the main thread's streams a moment after its answer.
        await new Promise((resolve) => setTimeout(resolve, STDIO_SETTLE_MS));
      } finally {
        stderr.mockRestore();
        stdout.mockRestore();
      }
      return written.join('');
    }

    it('sees what a worker writes to stderr (the control for the next test)', async () => {
      const output = await captureOutput(() =>
        extractPdfText(new Uint8Array(), {
          maxPages: 10,
          timeoutMs: 4000,
          workerUrl: fixture('noisy.worker.mjs'),
        }),
      );
      expect(output).toContain('PRIVATE-CV-MARKER');
    });

    it('keeps what PDF.js says about a file out of the process output', async () => {
      let result: Awaited<ReturnType<typeof extractPdfText>> | undefined;
      const output = await captureOutput(async () => {
        result = await extractPdfText(pdfWithFilter('PRIVATE-CV-MARKER'), {
          maxPages: 10,
          timeoutMs: 4000,
        });
      });
      // The PDF must get as far as its content stream, where PDF.js raises the warning.
      expect(result).toMatchObject({ ok: true });
      expect(output).not.toContain('PRIVATE-CV-MARKER');
    });
  });
});
