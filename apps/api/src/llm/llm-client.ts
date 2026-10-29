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
  /**
   * Text sent before `input` and marked for prompt caching: the source. A re-ask sends it again word for
   * word and reads it from the cache; the other role has another system prompt and cannot.
   */
  cached?: string;
  schema: z.ZodType<T>;
  /**
   * What the schema sent to the service cannot say (ids that must exist, sizes after kept text is filled
   * in): the problems, or null. A problem is asked again like a schema error. Kept out of the schema
   * because a refined schema compiles to a grammar the service refuses as too large.
   */
  check?: (output: T) => string | null;
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
// One re-ask with the validation error; a second invalid answer fails the step (v2: at most four calls).
const SCHEMA_REASKS = 1;
// The author writes the whole document after thinking about it; the other roles answer much less.
const MAX_TOKENS: Record<LlmRole, number> = {
  extractor: 16_000,
  writer: 16_000,
  judge: 16_000,
  author: 32_000,
  reviewer: 16_000,
};

const UNUSABLE_ANSWER = 'The AI returned an answer we could not use.';

/**
 * Structured calls to the model with every retry in one place: transport retries honouring
 * `retry-after`, re-asks with the validation error, all charged to the job's call budget. Output reaches
 * the caller only after the zod schema accepted it.
 */
@Injectable()
export class LlmClient {
  private readonly models: Record<LlmRole, string>;
  private readonly effort: Record<LlmRole, LlmEffort>;
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
      author: config.AUTHOR_MODEL,
      reviewer: config.REVIEWER_MODEL,
    };
    this.effort = {
      extractor: 'low',
      writer: 'medium',
      judge: 'high',
      author: config.AUTHOR_EFFORT,
      reviewer: config.REVIEWER_EFFORT,
    };
    this.log = logger.child({ module: 'llm' });
  }

  async parse<T>(request: LlmRequest<T>): Promise<T> {
    const model = this.models[request.role];
    let messages: LlmMessage[] = [turn(request, request.input)];
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
            effort: this.effort[request.role],
            maxTokens: MAX_TOKENS[request.role],
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
      const problem = result.kind === 'output' ? (request.check?.(result.output) ?? null) : null;
      if (result.kind === 'output' && problem !== null) {
        result = {
          kind: 'invalid',
          error: problem,
          stopReason: result.stopReason,
          usage: result.usage,
        };
      }
      this.logAttempt(request, model, started, {
        outcome: result.kind,
        stopReason: result.stopReason,
        inputTokens: result.usage?.input,
        outputTokens: result.usage?.output,
        cacheReadTokens: result.usage?.cacheRead,
        cacheWriteTokens: result.usage?.cacheWrite,
      });
      if (result.kind === 'output') return result.output;
      if (result.kind === 'refusal') throw new JobError('AI_REFUSED');
      invalidAnswers++;
      if (invalidAnswers > SCHEMA_REASKS) throw new JobError('INTERNAL', UNUSABLE_ANSWER);
      messages = [turn(request, reask(request.input, result.error))];
    }
  }

  private waitFor(error: TransportError, failures: number): number {
    if (error.retryAfterMs !== null) return Math.min(error.retryAfterMs, MAX_RETRY_AFTER_MS);
    return DEFAULT_WAITS_MS[Math.min(failures, DEFAULT_WAITS_MS.length) - 1] ?? DEFAULT_WAITS_MS[0];
  }

  /** One line per HTTP attempt: never the prompt, the source, facts or the answer. */
  private logAttempt<T>(
    request: LlmRequest<T>,
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

function turn<T>(request: LlmRequest<T>, input: string): LlmMessage {
  if (request.cached === undefined) return { role: 'user', content: input };
  return { role: 'user', content: [{ text: request.cached, cached: true }, { text: input }] };
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
