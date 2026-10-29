import { performance } from 'node:perf_hooks';
import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import type { z } from 'zod';
import type { AppConfig } from '../config/env.js';
import { APP_CONFIG, ROOT_LOGGER } from '../config/tokens.js';
import { JobError } from '../generation/job-errors.js';
import { LlmCallBudget, type BudgetedJob } from './llm-budget.js';
import {
  LlmTransport,
  TransportError,
  type LlmEffort,
  type LlmMessage,
  type LlmRole,
  type TransportResult,
} from './llm-transport.js';

export interface LlmRequest<T> {
  role: LlmRole;
  system: string;
  /** The user turn; source text only inside `<cv_source>…</cv_source>`. */
  input: string;
  schema: z.ZodType<T>;
  /** For the call budget and fencing. */
  job: BudgetedJob;
  /** Lost lease or shutdown. */
  signal: AbortSignal;
}

/** Waits between transport attempts; tests replace it so retries do not take real seconds. */
export const LLM_SLEEP = Symbol('LLM_SLEEP');
export type LlmSleep = (ms: number, signal: AbortSignal) => Promise<void>;

const TRANSPORT_ATTEMPTS = 3;
const DEFAULT_WAITS_MS = [1_000, 2_000] as const;
const MAX_RETRY_AFTER_MS = 30_000;
const SCHEMA_REASKS = 2;
const MAX_TOKENS = 16_000;
const EFFORT: Record<LlmRole, LlmEffort> = { extractor: 'low', writer: 'medium', judge: 'high' };

const UNUSABLE_ANSWER = 'The AI returned an answer we could not use.';

/**
 * Structured calls to the model with every retry in one place: transport retries honouring
 * `retry-after`, re-asks with the validation error, all charged to the job's call budget. Output reaches
 * the caller only after the zod schema accepted it.
 */
@Injectable()
export class LlmClient {
  private readonly models: Record<LlmRole, string>;
  private readonly log: Logger;

  constructor(
    @Inject(LlmTransport) private readonly transport: LlmTransport,
    @Inject(LlmCallBudget) private readonly budget: LlmCallBudget,
    @Inject(LLM_SLEEP) private readonly sleep: LlmSleep,
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(ROOT_LOGGER) logger: Logger,
  ) {
    this.models = {
      extractor: config.EXTRACTOR_MODEL,
      writer: config.WRITER_MODEL,
      judge: config.JUDGE_MODEL,
    };
    this.log = logger.child({ module: 'llm' });
  }

  async parse<T>(request: LlmRequest<T>): Promise<T> {
    const model = this.models[request.role];
    let messages: LlmMessage[] = [{ role: 'user', content: request.input }];
    let transportFailures = 0;
    let invalidAnswers = 0;
    for (;;) {
      request.signal.throwIfAborted();
      await this.budget.charge(request.job);
      const started = performance.now();
      let result: TransportResult<T>;
      try {
        result = await this.transport.send(
          {
            role: request.role,
            model,
            effort: EFFORT[request.role],
            maxTokens: MAX_TOKENS,
            system: request.system,
            messages,
            schema: request.schema,
          },
          request.signal,
        );
      } catch (error) {
        if (!(error instanceof TransportError)) throw error;
        this.logAttempt(request, model, started, { outcome: error.reason, status: error.status });
        transportFailures++;
        if (error.reason === 'auth')
          throw new JobError('AI_KEY_REJECTED', undefined, { cause: error });
        if (error.reason === 'rejected')
          throw new JobError('INTERNAL', undefined, { cause: error });
        if (transportFailures >= TRANSPORT_ATTEMPTS) {
          throw new JobError('AI_UNAVAILABLE', undefined, { cause: error });
        }
        await this.sleep(this.waitFor(error, transportFailures), request.signal);
        continue;
      }

      // Postgres rejects U+0000 and lone surrogates in jsonb, where step results are stored.
      if (result.kind === 'output' && !storable(result.output)) {
        result = {
          kind: 'invalid',
          error:
            'The answer contained a NUL character (U+0000) or a broken character; answer without it.',
          stopReason: result.stopReason,
          usage: result.usage,
        };
      }
      this.logAttempt(request, model, started, {
        outcome: result.kind,
        stopReason: result.stopReason,
        inputTokens: result.usage?.input,
        outputTokens: result.usage?.output,
      });
      if (result.kind === 'output') return result.output;
      if (result.kind === 'refusal') throw new JobError('AI_REFUSED');
      invalidAnswers++;
      if (invalidAnswers > SCHEMA_REASKS) throw new JobError('INTERNAL', UNUSABLE_ANSWER);
      messages = [{ role: 'user', content: reask(request.input, result.error) }];
    }
  }

  private waitFor(error: TransportError, failures: number): number {
    if (error.retryAfterMs !== null) return Math.min(error.retryAfterMs, MAX_RETRY_AFTER_MS);
    return DEFAULT_WAITS_MS[Math.min(failures, DEFAULT_WAITS_MS.length) - 1] ?? DEFAULT_WAITS_MS[0];
  }

  /** One line per HTTP attempt: never the prompt, the source, facts or the answer. */
  private logAttempt(
    request: LlmRequest<unknown>,
    model: string,
    started: number,
    fields: Record<string, unknown>,
  ): void {
    this.log.info(
      {
        jobId: request.job.id,
        role: request.role,
        model,
        latencyMs: Math.round(performance.now() - started),
        ...fields,
      },
      'llm call',
    );
  }
}

/** The original input plus why the last answer was refused, so the model can correct itself. */
function reask(input: string, error: string): string {
  return `${input}\n\n<previous_answer_error>\nYour previous answer could not be used:\n${error}\nAnswer again, following the required output schema exactly.\n</previous_answer_error>`;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Whether every string (and key) of the parsed answer can be stored in jsonb. The six characters `\u0000`
 * typed as text are fine; only the real character and lone surrogates are not.
 */
function storable(value: unknown): boolean {
  if (typeof value === 'string') return !value.includes('\u0000') && !LONE_SURROGATE.test(value);
  if (Array.isArray(value)) return value.every(storable);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).every(([key, item]) => storable(key) && storable(item));
  }
  return true;
}
