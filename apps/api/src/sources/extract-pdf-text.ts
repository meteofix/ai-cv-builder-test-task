import { Worker } from 'node:worker_threads';
import type { PdfTextResult } from './pdf-text.worker.js';

/** Vitest runs the TypeScript sources, where Node strips the types of the worker; `dist` holds compiled `.js`. */
const WORKER_URL = new URL(
  `./pdf-text.worker.${import.meta.url.endsWith('.ts') ? 'ts' : 'js'}`,
  import.meta.url,
);

export interface ExtractOptions {
  maxPages: number;
  timeoutMs: number;
  /** Replaced in tests with a worker that hangs. */
  workerUrl?: URL;
}

/** Why a worker that gave no answer failed, for the log: the file itself is never to blame in these cases. */
export interface WorkerFailure {
  ok: false;
  reason: 'invalid';
  cause: 'timeout' | 'worker_error' | 'worker_exit';
  /** `name` and `code` of the worker's error only: its message could quote the file. */
  errorName?: string;
  errorCode?: string;
}

export type ExtractResult = PdfTextResult | WorkerFailure;

/**
 * Extracts the text of an untrusted PDF in a worker thread with a time limit and a memory cap, so a
 * crafted file can neither block the event loop nor exhaust the process. A timeout, a crash or an
 * out-of-memory worker all count as an unreadable file; `cause` tells them apart from a bad PDF.
 */
export function extractPdfText(bytes: Uint8Array, options: ExtractOptions): Promise<ExtractResult> {
  return new Promise((resolve) => {
    const worker = new Worker(options.workerUrl ?? WORKER_URL, {
      workerData: { bytes, maxPages: options.maxPages },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    // The answer arrives before the exit that follows it, so the later calls are no-ops.
    const settle = (result: ExtractResult) => {
      clearTimeout(timer);
      // terminate() is a no-op once the worker has exited; it also stops one that is still looping.
      void worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(() => {
      settle({ ok: false, reason: 'invalid', cause: 'timeout' });
    }, options.timeoutMs);
    worker.once('message', (result: PdfTextResult) => {
      settle(result);
    });
    worker.once('error', (error: Error & { code?: string }) => {
      settle({
        ok: false,
        reason: 'invalid',
        cause: 'worker_error',
        errorName: error.name,
        ...(error.code ? { errorCode: error.code } : {}),
      });
    });
    worker.once('exit', () => {
      settle({ ok: false, reason: 'invalid', cause: 'worker_exit' });
    });
  });
}
