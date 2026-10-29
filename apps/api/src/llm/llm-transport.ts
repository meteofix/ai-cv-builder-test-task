import type { z } from 'zod';

/** `judge` is the eval's (pairwise judges, planted inventions); a generation uses the other two. */
export const LLM_ROLES = ['author', 'reviewer', 'judge'] as const;
export type LlmRole = (typeof LLM_ROLES)[number];
export const LLM_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type LlmEffort = (typeof LLM_EFFORTS)[number];

/** A block of the user turn; `cached` marks the end of the prefix the service may cache. */
export interface LlmBlock {
  text: string;
  cached?: boolean;
}

export interface LlmMessage {
  role: 'user';
  content: string | LlmBlock[];
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
  output: LlmOutputMode;
}

/**
 * How the answer comes back: `grammar` — structured outputs, the service constrains the answer to the
 * schema; `tool` — the input of a tool call the service does not constrain, for a schema too large for
 * the grammar (decision 036). Either way only the zod schema decides whether the answer is used.
 */
export type LlmOutputMode = 'grammar' | 'tool';

export interface TokenUsage {
  /** Input tokens billed at the full price (not read from or written to the cache). */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
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
