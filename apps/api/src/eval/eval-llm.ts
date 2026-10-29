import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import pino from 'pino';
import type { AppConfig } from '../config/env.js';
import { AnthropicTransport, createAnthropicSdk } from '../llm/anthropic-transport.js';
import { LlmCallBudget } from '../llm/llm-budget.js';
import { LlmClient } from '../llm/llm-client.js';
import {
  LlmTransport,
  TransportError,
  type TransportRequest,
  type TokenUsage,
  type TransportResult,
} from '../llm/llm-transport.js';

/** One HTTP attempt as the eval report shows it. */
export interface CallRecord {
  role: string;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outcome: string;
}

/** The production transport, with every attempt recorded for the report. */
class RecordingTransport extends LlmTransport {
  readonly calls: CallRecord[] = [];

  constructor(private readonly inner: LlmTransport) {
    super();
  }

  async send<T>(request: TransportRequest<T>, signal: AbortSignal): Promise<TransportResult<T>> {
    const started = performance.now();
    const record = (outcome: string, usage: TokenUsage | null) =>
      this.calls.push({
        role: request.role,
        model: request.model,
        latencyMs: Math.round(performance.now() - started),
        inputTokens: usage?.input ?? 0,
        outputTokens: usage?.output ?? 0,
        cacheReadTokens: usage?.cacheRead ?? 0,
        cacheWriteTokens: usage?.cacheWrite ?? 0,
        outcome,
      });
    try {
      const result = await this.inner.send(request, signal);
      record(
        result.kind === 'invalid' ? `invalid: ${result.error.slice(0, 300)}` : result.kind,
        result.usage,
      );
      return result;
    } catch (error) {
      // A failed attempt is a call too (the client retries it); the client handles the error itself.
      record(error instanceof TransportError ? error.reason : 'error', null);
      throw error;
    }
  }
}

/**
 * No job row backs an eval call, so nothing is charged; the report shows the calls per file next to
 * `LLM_CALL_BUDGET`, which a job would stop at. The base class's database is never touched.
 */
class UnmeteredBudget extends LlmCallBudget {
  override charge(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * The real `LlmClient` (retries and re-asks as in production) on the real Anthropic transport, for the
 * eval. Logs stay silent: the report records each call instead.
 */
export function evalClient(config: AppConfig, judgeModel?: string) {
  const transport = new RecordingTransport(new AnthropicTransport(createAnthropicSdk(config)));
  const client = new LlmClient(
    transport,
    new UnmeteredBudget(undefined as never, config),
    (ms, signal) => sleep(ms, undefined, { signal }),
    config,
    pino({ level: 'silent' }),
    judgeModel,
  );
  return { client, calls: transport.calls };
}
