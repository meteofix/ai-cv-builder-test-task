import { ApiError } from '../common/api-error.js';

function hasNul(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (Array.isArray(value)) return value.some(hasNul);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).some(([key, item]) => key.includes('\u0000') || hasNul(item));
  }
  return false;
}

/**
 * Postgres cannot store U+0000 in `text` or `jsonb`, and the shared schemas let it through; without this
 * check a request carrying one would end in a driver error and a 500. Strings are inspected one by one, so
 * the six characters `\u0000` typed as text are not mistaken for a NUL.
 */
export function assertNoNul(value: unknown, path: string): void {
  if (hasNul(value)) {
    throw new ApiError(
      'VALIDATION_FAILED',
      'The text contains a character that cannot be stored.',
      [{ path, message: 'Contains a NUL character' }],
    );
  }
}
