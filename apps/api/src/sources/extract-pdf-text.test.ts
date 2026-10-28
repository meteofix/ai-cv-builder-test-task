import { describe, expect, it } from 'vitest';
import { extractPdfText } from './extract-pdf-text.js';

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
});
