import type { JobErrorCode } from '@cv/shared';

/**
 * A job failure with the code the user sees. `retryable` failures go back to the queue while attempts
 * remain; the others fail the job at once. `message` is shown to the user: never CV content in it.
 */
export class JobError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: JobErrorCode,
    message?: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message ?? code, { cause: options.cause });
    this.name = 'JobError';
    this.retryable = options.retryable ?? code === 'AI_UNAVAILABLE';
  }

  /** The user-facing text, or undefined to use the default text of the code. */
  get userMessage(): string | undefined {
    return this.message === this.code ? undefined : this.message;
  }
}

/** A fenced write matched no row: another worker owns the job now, or the CV was deleted. */
export class LeaseLostError extends Error {
  constructor() {
    super('The job lease was lost');
    this.name = 'LeaseLostError';
  }
}

/**
 * Failures on the model's side that cost only an optional request (the extractor's repair and second
 * pass): what the first extraction found stands. The call budget and a lost lease still stop the job.
 */
export const OPTIONAL_REQUEST_FAILURES: ReadonlySet<string> = new Set([
  'INTERNAL',
  'AI_REFUSED',
  'AI_UNAVAILABLE',
]);
