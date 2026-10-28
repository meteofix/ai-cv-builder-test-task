import { z } from 'zod';

/** Machine-readable `code` of an `application/problem+json` response; the web app maps messages by it. */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'EMAIL_TAKEN',
  'FORBIDDEN',
  'NOT_FOUND',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'CV_NOT_FOUND',
  'QUESTION_NOT_FOUND',
  'DOCUMENT_NOT_READY',
  'VERSION_CONFLICT',
  'JOB_ACTIVE',
  'JOB_NOT_RETRYABLE',
  'QUESTION_CLOSED',
  'GENERATION_LIMIT_REACHED',
  'PDF_TOO_LARGE',
  'PDF_INVALID',
  'PDF_NO_TEXT',
  'PDF_ENCRYPTED',
  'PDF_TOO_MANY_PAGES',
  'PDF_RENDER_FAILED',
  'UNAVAILABLE',
  'INTERNAL',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** HTTP status of each code; the API's error class takes it from here, so a code cannot change status by route. */
export const ERROR_STATUS = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  EMAIL_TAKEN: 409,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  CV_NOT_FOUND: 404,
  QUESTION_NOT_FOUND: 404,
  DOCUMENT_NOT_READY: 409,
  VERSION_CONFLICT: 409,
  JOB_ACTIVE: 409,
  JOB_NOT_RETRYABLE: 409,
  QUESTION_CLOSED: 409,
  GENERATION_LIMIT_REACHED: 429,
  PDF_TOO_LARGE: 413,
  PDF_INVALID: 422,
  PDF_NO_TEXT: 422,
  PDF_ENCRYPTED: 422,
  PDF_TOO_MANY_PAGES: 422,
  PDF_RENDER_FAILED: 503,
  /** A dependency is down (the database for `/api/health/ready`). */
  UNAVAILABLE: 503,
  INTERNAL: 500,
} as const satisfies Record<ErrorCode, number>;

/** RFC 9457 problem details plus `code` and `requestId` (shown as "Error ID" on a 5xx). */
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  code: errorCodeSchema,
  requestId: z.string(),
  /** Only for VALIDATION_FAILED: which fields failed and why. */
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

export type Problem = z.infer<typeof problemSchema>;

/** Why a generation job failed; shown on the CV with a Retry button. */
export const JOB_ERROR_CODES = [
  'AI_UNAVAILABLE',
  'AI_LIMIT_REACHED',
  'AI_REFUSED',
  'AI_KEY_REJECTED',
  'INTERNAL',
] as const;

export const jobErrorCodeSchema = z.enum(JOB_ERROR_CODES);
export type JobErrorCode = z.infer<typeof jobErrorCodeSchema>;
