import type { z } from 'zod';

export const LLM_ROLES = ['extractor', 'writer', 'judge'] as const;
export type LlmRole = (typeof LLM_ROLES)[number];
export type LlmEffort = 'low' | 'medium' | 'high';

export interface LlmMessage {
  role: 'user';
  content: string;
}

/** One HTTP attempt as the client builds it. */
export interface TransportRequest<T> {
  role: LlmRole;
  model: string;
  effort: LlmEffort;
  maxTokens: number;
  system: string;
  messages: LlmMessage[];
  schema: z.ZodType<T>;
}

export interface TokenUsage {
  input: number;
  output: number;
}

/**
 * What one attempt produced. `invalid` covers every answer the schema did not accept: no parsed output, a
 * schema error, or a truncated answer (`max_tokens`); `error` is the validation message for the re-ask.
 */
export type TransportResult<T> =
  | { kind: 'output'; output: T; stopReason: string | null; usage: TokenUsage }
  | { kind: 'invalid'; error: string; stopReason: string | null; usage: TokenUsage | null }
  | { kind: 'refusal'; stopReason: string; usage: TokenUsage };

/**
 * An attempt that got no usable answer from the service: `transient` (429, 5xx overload, connection,
 * timeout) may be retried, `auth` (401/403) and `rejected` (any other 4xx) may not.
 */
export class TransportError extends Error {
  constructor(
    readonly reason: 'transient' | 'auth' | 'rejected',
    readonly status: number | null,
    /** From `retry-after`, when the service sent one. */
    readonly retryAfterMs: number | null = null,
    options: { cause?: unknown } = {},
  ) {
    super(`LLM request failed: ${reason}${status === null ? '' : ` (${status})`}`, options);
    this.name = 'TransportError';
  }
}

/**
 * One HTTP attempt to the model. The only implementation outside tests is the Anthropic SDK; tests
 * replace it with a scripted fake, so retries, the call budget and re-asks always run the real code.
 */
export abstract class LlmTransport {
  abstract send<T>(request: TransportRequest<T>, signal: AbortSignal): Promise<TransportResult<T>>;
}
