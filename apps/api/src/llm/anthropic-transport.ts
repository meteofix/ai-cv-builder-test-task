import Anthropic, { APIConnectionError, APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '../config/env.js';
import {
  LlmTransport,
  TransportError,
  type TransportRequest,
  type TransportResult,
} from './llm-transport.js';

/** The SDK client of the process; tests point it at a local server through `ANTHROPIC_BASE_URL`. */
export const ANTHROPIC_SDK = Symbol('ANTHROPIC_SDK');

/** Our client owns every retry, so SDK retries would multiply the calls and bypass the call budget. */
export function createAnthropicSdk(
  config: Pick<AppConfig, 'ANTHROPIC_API_KEY' | 'LLM_TIMEOUT_MS'>,
) {
  return new Anthropic({
    apiKey: config.ANTHROPIC_API_KEY,
    maxRetries: 0,
    timeout: config.LLM_TIMEOUT_MS,
  });
}

const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504, 529]);

@Injectable()
export class AnthropicTransport extends LlmTransport {
  constructor(@Inject(ANTHROPIC_SDK) private readonly sdk: Anthropic) {
    super();
  }

  async send<T>(request: TransportRequest<T>, signal: AbortSignal): Promise<TransportResult<T>> {
    const base = zodOutputFormat(request.schema);
    // The SDK parses every text block before we see `stop_reason`; a parse that throws would hide a
    // refusal or a cut-off answer, so the schema error is kept and judged after the stop reason.
    const captured: { error: string | null } = { error: null };
    const format = {
      ...base,
      parse: (content: string): T | null => {
        try {
          return base.parse(content);
        } catch (error) {
          captured.error =
            error instanceof Error ? error.message : 'The answer was not valid JSON.';
          return null;
        }
      },
    };
    let message;
    try {
      message = await this.sdk.messages.parse(
        {
          model: request.model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: request.messages,
          output_config: { effort: request.effort, format },
        },
        { signal },
      );
    } catch (error) {
      throw toTransportError(error) ?? error;
    }
    const usage = { input: message.usage.input_tokens, output: message.usage.output_tokens };
    const stopReason = message.stop_reason;
    if (stopReason === 'refusal') return { kind: 'refusal', stopReason, usage };
    if (stopReason === 'max_tokens') {
      return {
        kind: 'invalid',
        error: 'The answer was cut off at the token limit; answer more briefly.',
        stopReason,
        usage,
      };
    }
    const output = message.parsed_output;
    if (output === null) {
      const error = captured.error ?? 'The answer had no structured output.';
      return { kind: 'invalid', error, stopReason, usage };
    }
    return { kind: 'output', output, stopReason, usage };
  }
}

/** Maps SDK failures; returns null for errors that are not about the service (abort, our own bugs). */
function toTransportError(error: unknown): TransportError | null {
  if (error instanceof APIUserAbortError) return null;
  // Timeouts are connection errors in the SDK.
  if (error instanceof APIConnectionError) {
    return new TransportError('transient', null, null, { cause: error });
  }
  if (!isApiError(error)) return null;
  return statusError(error.status ?? null, error.headers?.get('retry-after'), error);
}

// `instanceof` alone narrows to `APIError<any, …>`; the predicate keeps the declared field types.
function isApiError(error: unknown): error is APIError {
  return error instanceof APIError;
}

/** Which HTTP statuses may be retried and how long the service asked us to wait. */
export function statusError(
  status: number | null,
  retryAfter: string | null | undefined,
  cause?: unknown,
): TransportError {
  if (status !== null && TRANSIENT_STATUSES.has(status)) {
    return new TransportError('transient', status, retryAfterMs(retryAfter), { cause });
  }
  if (status === 401 || status === 403) return new TransportError('auth', status, null, { cause });
  return new TransportError('rejected', status, null, { cause });
}

/** `retry-after` as seconds or an HTTP date; null when absent, unreadable or zero. */
export function retryAfterMs(value: string | null | undefined, now = Date.now()): number | null {
  if (!value?.trim()) return null;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  // Zero or a date in the past would retry at once and burn a budget call; the default wait applies.
  return Number.isNaN(ms) || ms <= 0 ? null : ms;
}
