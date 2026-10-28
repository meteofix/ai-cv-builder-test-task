import { STATUS_CODES } from 'node:http';
import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
  type StandardSchemaValidationPipeOptions,
} from '@nestjs/common';
import { ERROR_STATUS, type ErrorCode, type Problem } from '@cv/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from './api-error.js';

/** Code for an HTTP error that did not come from our code: Nest exceptions, the throttler, Fastify itself. */
const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'NOT_FOUND',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
  503: 'UNAVAILABLE',
};

/**
 * The one place that shapes error responses: `application/problem+json` (RFC 9457) with `code` and
 * `requestId`. Expected errors keep their detail; anything unexpected is logged with its stack and answered
 * with a bare 500, so internals never reach the client.
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const problem = this.toProblem(exception, request);

    if (problem.status >= 500) {
      // Name, code and stack only: driver errors can carry row values in other fields.
      const error = exception instanceof Error ? exception : new Error(String(exception));
      request.log.error(
        {
          err: {
            name: error.name,
            message: error.message,
            code: codeOf(error),
            stack: error.stack,
          },
        },
        'Request failed',
      );
    }

    void reply
      .status(problem.status)
      .header('content-type', 'application/problem+json')
      .send(problem);
  }

  private toProblem(exception: unknown, request: FastifyRequest): Problem {
    const requestId = request.id;
    if (exception instanceof ApiError) {
      return problem(
        exception.getStatus(),
        exception.code,
        requestId,
        exception.detail,
        exception.errors,
      );
    }
    // The status follows the code (ERROR_STATUS), so a code means the same status everywhere: a 405 is a
    // 404 NOT_FOUND, a 415 a 400 VALIDATION_FAILED.
    const status = statusOf(exception);
    const code = CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED');
    return problem(ERROR_STATUS[code], code, requestId);
  }
}

function problem(
  status: number,
  code: ErrorCode,
  requestId: string,
  detail?: string,
  errors?: Problem['errors'],
): Problem {
  return {
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Error',
    status,
    ...(detail === undefined ? {} : { detail }),
    code,
    requestId,
    ...(errors === undefined ? {} : { errors }),
  };
}

/** Nest exceptions carry a status; Fastify's own errors (bad JSON, body too large) carry `statusCode`. */
function statusOf(exception: unknown): number {
  if (exception instanceof HttpException) return exception.getStatus();
  const statusCode = (exception as { statusCode?: unknown } | null)?.statusCode;
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 600 ? statusCode : 500;
}

function codeOf(error: Error): string | undefined {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

type Issues = Parameters<NonNullable<StandardSchemaValidationPipeOptions['exceptionFactory']>>[0];

/** Turns Standard Schema issues into VALIDATION_FAILED with one entry per failing field. */
export function validationError(issues: Issues): ApiError {
  return new ApiError(
    'VALIDATION_FAILED',
    'The request is not valid.',
    issues.map((issue) => ({
      path: (issue.path ?? [])
        .map((segment) => String(typeof segment === 'object' ? segment.key : segment))
        .join('.'),
      message: issue.message,
    })),
  );
}
