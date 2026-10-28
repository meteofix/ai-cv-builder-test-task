import { Inject, Injectable } from '@nestjs/common';
import { LIMITS } from '@cv/shared';
import type { Logger } from 'pino';
import { ApiError } from '../common/api-error.js';
import { ROOT_LOGGER } from '../config/tokens.js';
import { extractPdfText } from './extract-pdf-text.js';

const PDF_MAGIC = Buffer.from('%PDF-');
const PDF_TIMEOUT_MS = 10_000;
/** Each extraction is a worker with a 256 MB heap cap and a copy of the file; this bounds what uploads can take. */
const MAX_CONCURRENT_EXTRACTIONS = 3;

/** Turns an uploaded file into the source text of a CV. The bytes are never stored, only the text. */
@Injectable()
export class SourcesService {
  private readonly logger: Logger;
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(@Inject(ROOT_LOGGER) logger: Logger) {
    this.logger = logger.child({ context: 'sources' });
  }

  async textFromPdf(bytes: Buffer): Promise<string> {
    // The name and the declared content type come from the client and are ignored.
    if (!bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
      throw new ApiError('PDF_INVALID', 'The file is not a PDF.');
    }
    const result = await this.limited(() =>
      extractPdfText(bytes, { maxPages: LIMITS.maxPdfPages, timeoutMs: PDF_TIMEOUT_MS }),
    );
    if (!result.ok) {
      // A worker that timed out or died is not necessarily the user's fault (a broken deploy looks the same).
      if ('cause' in result) {
        this.logger.warn(
          { cause: result.cause, errorName: result.errorName, errorCode: result.errorCode },
          'PDF worker gave no answer',
        );
      }
      throw refusal(result.reason);
    }

    if (!/\p{L}/u.test(result.text)) {
      throw new ApiError(
        'PDF_NO_TEXT',
        'The PDF has no text we can read, it looks scanned. Paste the text of your CV instead.',
      );
    }
    if (result.text.length > LIMITS.maxSourceChars) {
      throw new ApiError(
        'VALIDATION_FAILED',
        `The text of the PDF is longer than ${LIMITS.maxSourceChars} characters. Shorten the CV or paste only the relevant parts.`,
      );
    }
    return result.text;
  }

  /** Runs `work` when fewer than MAX_CONCURRENT_EXTRACTIONS are running; later callers wait their turn. */
  private async limited<T>(work: () => Promise<T>): Promise<T> {
    if (this.running < MAX_CONCURRENT_EXTRACTIONS) this.running++;
    // A finished run hands its slot straight to the next waiter, so a newcomer cannot slip in between.
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.running--;
    }
  }
}

function refusal(reason: 'encrypted' | 'too_many_pages' | 'invalid'): ApiError {
  switch (reason) {
    case 'encrypted':
      return new ApiError(
        'PDF_ENCRYPTED',
        'The PDF is password-protected. Remove the password and try again.',
      );
    case 'too_many_pages':
      return new ApiError(
        'PDF_TOO_MANY_PAGES',
        `The PDF has more than ${LIMITS.maxPdfPages} pages.`,
      );
    case 'invalid':
      return new ApiError('PDF_INVALID', 'The file could not be read as a PDF.');
  }
}
