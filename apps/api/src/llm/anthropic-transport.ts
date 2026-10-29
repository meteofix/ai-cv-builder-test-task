import Anthropic, { APIConnectionError, APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
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
    return request.output === 'tool'
      ? this.sendAsTool(request, signal)
      : this.sendWithGrammar(request, signal);
  }

  private async sendWithGrammar<T>(
    request: TransportRequest<T>,
    signal: AbortSignal,
  ): Promise<TransportResult<T>> {
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
    const message = await this.call(() =>
      this.sdk.messages.parse(
        {
          ...this.params(request),
          output_config: { effort: request.effort, format },
        },
        { signal },
      ),
    );
    const early = stopped<T>(message);
    if (early) return early;
    const output = message.parsed_output;
    if (output === null) {
      const error = captured.error ?? 'The answer had no structured output.';
      return { kind: 'invalid', error, stopReason: message.stop_reason, usage: usageOf(message) };
    }
    return { kind: 'output', output, stopReason: message.stop_reason, usage: usageOf(message) };
  }

  /**
   * The answer as the input of one tool call. Opus 5.5 refuses a forced `tool_choice`, so the choice is
   * `auto` and the system prompt asks for the call; an answer without it is invalid and asked again.
   */
  private async sendAsTool<T>(
    request: TransportRequest<T>,
    signal: AbortSignal,
  ): Promise<TransportResult<T>> {
    const message = await this.call(() =>
      this.sdk.messages.create(
        {
          ...this.params(request),
          system: `${request.system}\n\nGive your whole answer as one call of the ${ANSWER_TOOL} tool, with no other text.`,
          tools: [
            {
              name: ANSWER_TOOL,
              description: 'The answer, in the required schema.',
              input_schema: toolSchema(request.schema),
            },
          ],
          tool_choice: { type: 'auto', disable_parallel_tool_use: true },
          output_config: { effort: request.effort },
        },
        { signal },
      ),
    );
    const early = stopped<T>(message);
    if (early) return early;
    const usage = usageOf(message);
    const call = message.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === 'tool_use' && block.name === ANSWER_TOOL,
    );
    if (!call) {
      return {
        kind: 'invalid',
        error: `The answer was not a call of the ${ANSWER_TOOL} tool.`,
        stopReason: message.stop_reason,
        usage,
      };
    }
    const parsed = request.schema.safeParse(call.input);
    return parsed.success
      ? { kind: 'output', output: parsed.data, stopReason: message.stop_reason, usage }
      : {
          kind: 'invalid',
          error: z.prettifyError(parsed.error),
          stopReason: message.stop_reason,
          usage,
        };
  }

  private params(request: TransportRequest<unknown>) {
    return {
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: request.messages.map((message) => ({
        role: message.role,
        content:
          typeof message.content === 'string'
            ? message.content
            : message.content.map((block) => ({
                type: 'text' as const,
                text: block.text,
                ...(block.cached ? { cache_control: { type: 'ephemeral' as const } } : {}),
              })),
      })),
    };
  }

  private async call<M>(send: () => Promise<M>): Promise<M> {
    try {
      return await send();
    } catch (error) {
      throw toTransportError(error) ?? error;
    }
  }
}

export const ANSWER_TOOL = 'answer';

/** The tool's input schema: plain JSON Schema of the zod schema, which the service does not compile. */
export function toolSchema(schema: z.ZodType): Anthropic.Tool.InputSchema {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  return { ...json, type: 'object' };
}

function usageOf(message: Anthropic.Message) {
  return {
    input: message.usage.input_tokens,
    output: message.usage.output_tokens,
    cacheRead: message.usage.cache_read_input_tokens ?? 0,
    cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
  };
}

/** A refusal or a cut-off answer, which no parse can rescue; null when the answer ended normally. */
function stopped<T>(message: Anthropic.Message): TransportResult<T> | null {
  const usage = usageOf(message);
  if (message.stop_reason === 'refusal') {
    return { kind: 'refusal', stopReason: message.stop_reason, usage };
  }
  if (message.stop_reason === 'max_tokens') {
    return {
      kind: 'invalid',
      error: 'The answer was cut off at the token limit; answer more briefly.',
      stopReason: message.stop_reason,
      usage,
    };
  }
  return null;
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
