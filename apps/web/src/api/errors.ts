import { LIMITS, problemSchema, type ErrorCode } from '@cv/shared';

/** `OFFLINE` is the only code the server never sends: the request did not get an answer at all. */
export type ApiErrorCode = ErrorCode | 'OFFLINE';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    readonly detail?: string,
    readonly requestId?: string,
  ) {
    super(detail ?? code);
    this.name = 'ApiError';
  }
}

/** nginx answers 413, 502 and 504 itself, with an HTML body and no `code`; the status decides. */
function codeForStatus(status: number): ErrorCode {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status === 502 || status === 503 || status === 504) return 'UNAVAILABLE';
  return 'INTERNAL';
}

export async function readApiError(response: Response): Promise<ApiError> {
  const text = await response.text();
  try {
    const problem = problemSchema.safeParse(JSON.parse(text));
    if (problem.success) {
      const { code, detail, requestId } = problem.data;
      return new ApiError(response.status, code, detail, requestId);
    }
  } catch {
    // Not JSON: an error page from nginx.
  }
  return new ApiError(response.status, codeForStatus(response.status));
}

const MAX_PDF_MB = LIMITS.maxPdfBytes / (1024 * 1024);

const MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  VALIDATION_FAILED: 'Some of the entered data is not valid.',
  UNAUTHENTICATED: 'Your session has expired. Log in again.',
  INVALID_CREDENTIALS: 'Wrong email or password.',
  EMAIL_TAKEN: 'An account with this email already exists.',
  RATE_LIMITED: 'Too many attempts. Wait a minute and try again.',
  PAYLOAD_TOO_LARGE: `The file is too large (max ${MAX_PDF_MB} MB).`,
  CV_NOT_FOUND: 'This CV does not exist.',
  DOCUMENT_NOT_READY: 'The CV is not ready yet.',
  VERSION_CONFLICT: 'This CV was changed elsewhere. We loaded the latest version.',
  JOB_ACTIVE: 'The CV is being updated. Try again when it is done.',
  JOB_NOT_RETRYABLE: 'This job cannot be retried.',
  QUESTION_CLOSED: 'This question is already closed.',
  PDF_TOO_LARGE: `The PDF is too large (max ${MAX_PDF_MB} MB).`,
  PDF_INVALID: 'This file is not a valid PDF.',
  PDF_NO_TEXT: 'This PDF has no text layer (it looks scanned). Paste the text instead.',
  PDF_ENCRYPTED: 'This PDF is password-protected. Remove the password or paste the text instead.',
  PDF_TOO_MANY_PAGES: `This PDF has more than ${LIMITS.maxPdfPages} pages. Paste the text instead.`,
  PDF_RENDER_FAILED: 'The PDF could not be created. Try again.',
  UNAVAILABLE: 'Cannot reach the server. Try again in a moment.',
  OFFLINE: 'You are offline. Check your connection and try again.',
};

/** Codes whose server `detail` is the message (it names the limit that was hit). */
const DETAIL_CODES = new Set<ApiErrorCode>(['GENERATION_LIMIT_REACHED']);

/**
 * The text a person sees. Server errors (5xx) carry the request id, so a report can be traced in the logs.
 * `overrides` lets a screen word a code for its own context.
 */
export function errorMessage(
  error: unknown,
  overrides: Partial<Record<ApiErrorCode, string>> = {},
): string {
  if (!(error instanceof ApiError)) return 'Something went wrong.';
  const message =
    overrides[error.code] ??
    (DETAIL_CODES.has(error.code) ? error.detail : undefined) ??
    MESSAGES[error.code] ??
    'Something went wrong.';
  const serverFault = error.status >= 500 && error.code !== 'UNAVAILABLE';
  return serverFault && error.requestId ? `${message} Error ID: ${error.requestId}` : message;
}
