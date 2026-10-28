import { ApiError } from '../common/api-error.js';

/**
 * Postgres cannot store U+0000 in `text` or `jsonb`, and the shared schemas let it through; without this
 * check a request carrying one would end in a driver error and a 500.
 */
export function assertNoNul(value: string, path: string): void {
  if (value.includes('\u0000')) {
    throw new ApiError(
      'VALIDATION_FAILED',
      'The text contains a character that cannot be stored.',
      [{ path, message: 'Contains a NUL character' }],
    );
  }
}

/** The same check for a JSON value, where a NUL in a string appears as the escape `\u0000`. */
export function assertNoNulInJson(value: unknown, path: string): void {
  if (JSON.stringify(value).includes(String.raw`\u0000`)) {
    throw new ApiError(
      'VALIDATION_FAILED',
      'The text contains a character that cannot be stored.',
      [{ path, message: 'Contains a NUL character' }],
    );
  }
}
