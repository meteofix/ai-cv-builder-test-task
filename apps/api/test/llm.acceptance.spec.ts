import { APIUserAbortError } from '@anthropic-ai/sdk';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AppConfig } from '../src/config/env.js';
import { ROOT_LOGGER } from '../src/config/tokens.js';
import { GenerationJob, type IGenerationJob } from '../src/db/entities.js';
import { JobError, LeaseLostError } from '../src/generation/job-errors.js';
import { LlmCallBudget } from '../src/llm/llm-budget.js';
import { LLM_SLEEP, LlmClient, type LlmRequest } from '../src/llm/llm-client.js';
import type { LlmRole } from '../src/llm/llm-transport.js';
import { createTestApp } from './support/create-test-app.js';
import { entityManager, resetDatabase } from './support/db.js';
import { createCv, createJob, createUser } from './support/factories.js';
import { answer, failure, fakeAnthropic } from './llm/fake-anthropic.js';

/**
 * The LLM client with the production SDK client (`createAnthropicSdk`: no SDK retries, the configured
 * timeout) against a local HTTP server (docs/specs/generation.md §2). Each test name starts with the
 * acceptance example it covers at the client level; the job-level part is in generation.acceptance.spec.ts.
 */
const summarySchema = z.object({ summary: z.string() });
const WORKER = 'worker-1';

function rejectsWithCode(promise: Promise<unknown>, code: string) {
  return expect(promise).rejects.toSatisfy(
    (error) => error instanceof JobError && error.code === code,
  );
}

describe('LLM client against a fake Anthropic API (docs/specs/generation.md §2)', () => {
  let server: Awaited<ReturnType<typeof fakeAnthropic>>;
  const sleeps: number[] = [];
  const logs: Record<string, unknown>[] = [];
  const apps: NestFastifyApplication[] = [];
  let app: NestFastifyApplication;
  let job: IGenerationJob;
  const baseUrlBefore = process.env.ANTHROPIC_BASE_URL;

  async function start(config: Partial<AppConfig> = {}) {
    const started = await createTestApp(config, {
      overrides: [
        {
          provide: LLM_SLEEP,
          useValue: (ms: number) => {
            sleeps.push(ms);
            return Promise.resolve();
          },
        },
        {
          provide: ROOT_LOGGER,
          useValue: pino(
            { level: 'info' },
            {
              write: (line: string) => {
                logs.push(JSON.parse(line) as Record<string, unknown>);
              },
            },
          ),
        },
      ],
    });
    apps.push(started);
    return started;
  }

  beforeAll(async () => {
    server = await fakeAnthropic();
    // The SDK client of the module reads its base URL from here, so the real factory is under test.
    process.env.ANTHROPIC_BASE_URL = server.url;
    app = await start();
  });
  afterAll(async () => {
    for (const started of apps) await started.close();
    await server.close();
    if (baseUrlBefore === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = baseUrlBefore;
  });
  beforeEach(async () => {
    await resetDatabase(app);
    sleeps.length = 0;
    logs.length = 0;
    server.reply(answer({ summary: 'Engineer.' }));
    const em = entityManager(app);
    job = await createJob(em, {
      cv: await createCv(em, { user: await createUser(em) }),
      status: 'running',
      lockedBy: WORKER,
      lockedUntil: new Date(Date.now() + 30_000),
    });
  });

  function request(overrides: Partial<LlmRequest<{ summary: string }>> = {}) {
    return {
      role: 'writer' as LlmRole,
      system: 'You write CV summaries.',
      input: '<cv_source>Iryna Kovalenko, Senior Engineer at Acme Corp</cv_source>',
      schema: summarySchema,
      job: { id: job.id, lockedBy: WORKER },
      signal: new AbortController().signal,
      ...overrides,
    };
  }
  const llmCalls = async (on = app) =>
    (await entityManager(on).findOneOrFail(GenerationJob, job.id)).llmCalls;
  const sentMessages = () =>
    server.requests.map((sent) => sent.body.messages as { role: string; content: unknown }[]);

  it.each([
    ['extractor', 'claude-haiku-5-5', 'low', 16_000],
    ['writer', 'claude-sonnet-5-5', 'medium', 16_000],
    ['judge', 'claude-opus-5-5', 'high', 16_000],
    ['author', 'claude-opus-5-5', 'medium', 32_000],
    ['reviewer', 'claude-opus-5-5', 'medium', 16_000],
  ] as const)(
    'sends a %s call to %s with effort %s, structured output and no temperature',
    async (role, model, effort, maxTokens) => {
      await expect(app.get(LlmClient).parse(request({ role }))).resolves.toEqual({
        summary: 'Engineer.',
      });
      expect(server.requests).toHaveLength(1);
      const body = server.requests[0]!.body;
      expect(server.requests[0]!.path).toBe('/v1/messages');
      expect(body).toMatchObject({
        model,
        max_tokens: maxTokens,
        system: 'You write CV summaries.',
        messages: [{ role: 'user', content: request().input }],
        output_config: { effort, format: { type: 'json_schema' } },
      });
      expect(body).not.toHaveProperty('temperature');
      expect(await llmCalls()).toBe(1);
    },
  );

  it('GEN-9 — re-asks once with the original input and the validation error, then fails with INTERNAL', async () => {
    server.reply(answer({ headline: 'not a summary' }));
    await rejectsWithCode(app.get(LlmClient).parse(request()), 'INTERNAL');
    const [first, reask] = sentMessages();
    expect(sentMessages()).toHaveLength(2);
    expect(sentMessages().every((messages) => messages.length === 1)).toBe(true);
    expect(first?.[0]?.content).toBe(request().input);
    expect(reask?.[0]?.content).toContain(request().input);
    expect(reask?.[0]?.content).toContain('<previous_answer_error>');
    expect(reask?.[0]?.content).toContain('summary');
    expect(await llmCalls()).toBe(2);
  });

  it("GEN-9 — re-asks when the request's check finds a problem the schema cannot express", async () => {
    server.reply(answer({ summary: 'Engineer.' }), answer({ summary: 'Engineer at Acme.' }));
    const check = (output: { summary: string }) =>
      output.summary.includes('Acme') ? null : 'Name the employer';
    await expect(app.get(LlmClient).parse({ ...request(), check })).resolves.toEqual({
      summary: 'Engineer at Acme.',
    });
    expect(sentMessages()[1]?.[0]?.content).toContain('Name the employer');
  });

  it('sends a cached prefix as its own block marked for caching, also in the re-ask', async () => {
    server.reply(answer({ headline: 'not a summary' }), answer({ summary: 'Engineer.' }));
    await app.get(LlmClient).parse({ ...request(), cached: '<cv_source>\nS1: x\n</cv_source>' });
    for (const messages of sentMessages()) {
      expect(messages[0]?.content).toEqual([
        {
          type: 'text',
          text: '<cv_source>\nS1: x\n</cv_source>',
          cache_control: { type: 'ephemeral' },
        },
        expect.objectContaining({ type: 'text' }),
      ]);
    }
  });

  it.each([
    ['text that is not JSON', answer(null, { text: 'Here is your summary!' })],
    ['an answer cut off at max_tokens', answer(null, { text: '{"summ', stopReason: 'max_tokens' })],
  ])('GEN-9 — treats %s as invalid output and re-asks', async (_case, invalid) => {
    server.reply(invalid, answer({ summary: 'Engineer.' }));
    await expect(app.get(LlmClient).parse(request())).resolves.toEqual({ summary: 'Engineer.' });
    expect(server.requests).toHaveLength(2);
  });

  it('GEN-9 — tells the model a cut-off answer was cut off', async () => {
    server.reply(
      answer(null, { text: '{"summ', stopReason: 'max_tokens' }),
      answer({ summary: 'x' }),
    );
    await app.get(LlmClient).parse(request());
    expect(sentMessages()[1]?.[0]?.content).toContain('cut off at the token limit');
    expect(logs).toContainEqual(
      expect.objectContaining({ outcome: 'invalid', stopReason: 'max_tokens' }),
    );
  });

  it('GEN-16 — retries a transient failure twice, waiting 1 s then 2 s, then AI_UNAVAILABLE', async () => {
    server.reply(failure(529));
    await rejectsWithCode(app.get(LlmClient).parse(request()), 'AI_UNAVAILABLE');
    // Exactly three requests: the production client has no SDK retries underneath ours.
    expect(server.requests).toHaveLength(3);
    expect(sleeps).toEqual([1_000, 2_000]);
    expect(await llmCalls()).toBe(3);
  });

  it.each([429, 500, 502, 503, 504, 529])('GEN-16 — %i is transient', async (status) => {
    server.reply(failure(status), answer({ summary: 'Engineer.' }));
    await expect(app.get(LlmClient).parse(request())).resolves.toEqual({ summary: 'Engineer.' });
    expect(server.requests).toHaveLength(2);
  });

  it('GEN-16 — a dropped connection is transient', async () => {
    server.reply('drop', answer({ summary: 'Engineer.' }));
    await expect(app.get(LlmClient).parse(request())).resolves.toEqual({ summary: 'Engineer.' });
    expect(server.requests).toHaveLength(2);
  });

  it('GEN-16 — a request over LLM_TIMEOUT_MS is transient', async () => {
    const impatient = await start({ LLM_TIMEOUT_MS: 300 });
    server.reply('hang', answer({ summary: 'Engineer.' }));
    await expect(impatient.get(LlmClient).parse(request())).resolves.toEqual({
      summary: 'Engineer.',
    });
    expect(server.requests).toHaveLength(2);
  });

  it.each([
    ['seconds', () => '3', 3_000, 3_000],
    ['an HTTP date', () => new Date(Date.now() + 5_000).toUTCString(), 3_000, 5_000],
    ['seconds above the 30 s cap', () => '120', 30_000, 30_000],
    ['zero (the default wait instead)', () => '0', 1_000, 1_000],
  ])('GEN-16 — waits as retry-after says in %s', async (_case, header, low, high) => {
    server.reply(failure(429, { 'retry-after': header() }), answer({ summary: 'Engineer.' }));
    await app.get(LlmClient).parse(request());
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(low);
    expect(sleeps[0]).toBeLessThanOrEqual(high);
  });

  it('GEN-16 — stops sending once the call budget is used up, even inside its own retries', async () => {
    const tight = await start({ LLM_CALL_BUDGET: 2 });
    server.reply(failure(529));
    await rejectsWithCode(tight.get(LlmClient).parse(request()), 'AI_LIMIT_REACHED');
    expect(server.requests).toHaveLength(2);
    expect(await llmCalls(tight)).toBe(2);
  });

  it.each([
    [401, 'AI_KEY_REJECTED'],
    [403, 'AI_KEY_REJECTED'],
    [400, 'INTERNAL'],
    [404, 'INTERNAL'],
  ])('GEN-17 — does not retry a %i: %s after one request', async (status, code) => {
    server.reply(failure(status));
    await rejectsWithCode(app.get(LlmClient).parse(request()), code);
    expect(server.requests).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('GEN-17 — does not retry a refusal, even one with explanatory text: AI_REFUSED', async () => {
    server.reply(answer(null, { text: 'I cannot help with that.', stopReason: 'refusal' }));
    await rejectsWithCode(app.get(LlmClient).parse(request()), 'AI_REFUSED');
    expect(server.requests).toHaveLength(1);
    expect(logs).toContainEqual(
      expect.objectContaining({ outcome: 'refusal', stopReason: 'refusal' }),
    );
  });

  describe('lease and abort', () => {
    it('sends nothing for a job whose lease is gone', async () => {
      await entityManager(app).nativeUpdate(GenerationJob, { id: job.id }, { lockedBy: 'thief' });
      await expect(app.get(LlmClient).parse(request())).rejects.toBeInstanceOf(LeaseLostError);
      expect(server.requests).toHaveLength(0);
    });

    it('sends nothing for a job that is no longer running', async () => {
      await entityManager(app).nativeUpdate(GenerationJob, { id: job.id }, { status: 'failed' });
      await expect(app.get(LlmClient).parse(request())).rejects.toBeInstanceOf(LeaseLostError);
      expect(server.requests).toHaveLength(0);
    });

    it('sends nothing once the job is aborted', async () => {
      const aborted = new AbortController();
      aborted.abort();
      await expect(app.get(LlmClient).parse(request({ signal: aborted.signal }))).rejects.toThrow(
        expect.objectContaining({ name: 'AbortError' }) as Error,
      );
      expect(server.requests).toHaveLength(0);
      expect(await llmCalls()).toBe(0);
    });

    it('stops a request in flight when the job is aborted, without turning it into a job error', async () => {
      server.reply('hang');
      const controller = new AbortController();
      const call = app.get(LlmClient).parse(request({ signal: controller.signal }));
      await expect.poll(() => server.requests.length).toBe(1);
      controller.abort();
      await expect(call).rejects.toBeInstanceOf(APIUserAbortError);
      expect(server.requests).toHaveLength(1);
    });
  });

  it('charges a budget of N-1 exactly N-1 times under N parallel charges', async () => {
    const tight = await start({ LLM_CALL_BUDGET: 4 });
    const budget = tight.get(LlmCallBudget);
    const results = await Promise.allSettled(
      [1, 2, 3, 4, 5].map(() => budget.charge({ id: job.id, lockedBy: WORKER })),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(4);
    const [rejected] = results.filter((result) => result.status === 'rejected');
    expect((rejected?.reason as JobError).code).toBe('AI_LIMIT_REACHED');
    expect(await llmCalls(tight)).toBe(4);
  });

  it('logs one line per HTTP attempt without the prompt, the source or the answer', async () => {
    server.reply(failure(529), answer({ summary: 'Senior Engineer at Acme Corp.' }));
    await app.get(LlmClient).parse(request());
    const calls = logs.filter((line) => line.msg === 'llm call');
    expect(calls).toEqual([
      expect.objectContaining({ jobId: job.id, role: 'writer', outcome: 'transient', status: 529 }),
      expect.objectContaining({
        jobId: job.id,
        role: 'writer',
        model: 'claude-sonnet-5-5',
        outcome: 'output',
        stopReason: 'end_turn',
        inputTokens: 12,
        outputTokens: 7,
        latencyMs: expect.any(Number) as number,
      }),
    ]);
    const all = JSON.stringify(logs);
    expect(all).not.toContain('Iryna');
    expect(all).not.toContain('Acme');
    expect(all).not.toContain('You write CV summaries');
  });
});
