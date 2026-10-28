import { HttpException } from '@nestjs/common';
import { ERROR_STATUS, type ErrorCode, type Problem } from '@cv/shared';

/**
 * An expected failure with a stable `code` from `@cv/shared`. The HTTP status comes from the code, so a
 * code means the same everywhere. `detail` is shown to the user: never put CV text, emails or ids in it.
 */
export class ApiError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    readonly detail?: string,
    readonly errors?: Problem['errors'],
  ) {
    super(detail ?? code, ERROR_STATUS[code]);
  }
}
