import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LLM_SLEEP, LlmClient } from '../src/llm/llm-client.js';
import { createTestApp } from './support/create-test-app.js';
import { entityManager, resetDatabase } from './support/db.js';
import { createCv, createJob, createUser } from './support/factories.js';
import { answer, fakeAnthropic, toolCall } from './llm/fake-anthropic.js';

/**
 * The `tool` output mode (decision 036), against the production SDK client: the answer is the input of a
 * tool call the service does not constrain, so only the zod schema decides and a miss is asked again.
 */
describe('LLM client: answers as a tool call', () => {
  let server: Awaited<ReturnType<typeof fakeAnthropic>>;
  let app: NestFastifyApplication;
  let job: { id: string; lockedBy: string };
  const baseUrlBefore = process.env.ANTHROPIC_BASE_URL;

  beforeAll(async () => {
    server = await fakeAnthropic();
    process.env.ANTHROPIC_BASE_URL = server.url;
    app = await createTestApp(
      {},
      { overrides: [{ provide: LLM_SLEEP, useValue: () => Promise.resolve() }] },
    );
  });
  afterAll(async () => {
    await app.close();
    await server.close();
    if (baseUrlBefore === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = baseUrlBefore;
  });
  beforeEach(async () => {
    await resetDatabase(app);
    const em = entityManager(app);
    const created = await createJob(em, {
      cv: await createCv(em, { user: await createUser(em) }),
      status: 'running',
      lockedBy: 'worker-1',
    });
    job = { id: created.id, lockedBy: 'worker-1' };
  });

  const parse = () =>
    app.get(LlmClient).parse({
      role: 'author',
      system: 'You write.',
      input: '<cv_source>x</cv_source>',
      schema: z.object({ summary: z.string(), years: z.number() }),
      output: 'tool',
      job,
      signal: new AbortController().signal,
    });
  const body = (i: number) => server.requests[i]?.body ?? {};
  const lastUserTurn = () =>
    JSON.stringify((server.requests.at(-1)?.body.messages as unknown[] | undefined)?.at(-1));

  it('sends the schema as a tool the model chooses itself and returns its input', async () => {
    server.reply(toolCall({ summary: 'Engineer.', years: 5 }));
    await expect(parse()).resolves.toEqual({ summary: 'Engineer.', years: 5 });
    const request = body(0);
    expect(request.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
    expect(request.tools).toEqual([
      expect.objectContaining({
        name: 'answer',
        input_schema: expect.objectContaining({ type: 'object' }) as unknown,
      }),
    ]);
    expect(request).not.toHaveProperty('output_config.format');
    expect(String(request.system)).toContain('one call of the answer tool');
  });

  it.each([
    ['plain text instead of the call', answer({ summary: 'Engineer.', years: 5 }), 'not a call'],
    ['another tool', toolCall({ summary: 'Engineer.', years: 5 }, 'other'), 'not a call'],
    ['an input the schema refuses', toolCall({ summary: 'Engineer.', years: 'five' }), 'years'],
    // A call cut off at the token limit is invalid even when its partial input happens to parse.
    [
      'a call cut off at max_tokens',
      toolCall({ summary: 'Engineer.', years: 5 }, 'answer', 'max_tokens'),
      'cut off at the token limit',
    ],
  ])('asks again after %s', async (_case, first, error) => {
    server.reply(first, toolCall({ summary: 'Engineer.', years: 5 }));
    await expect(parse()).resolves.toEqual({ summary: 'Engineer.', years: 5 });
    expect(server.requests).toHaveLength(2);
    expect(lastUserTurn()).toContain(error);
  });

  it('treats a refusal as final even when the answer also holds a valid call', async () => {
    server.reply(toolCall({ summary: 'Engineer.', years: 5 }, 'answer', 'refusal'));
    await expect(parse()).rejects.toMatchObject({ code: 'AI_REFUSED' });
    expect(server.requests).toHaveLength(1);
  });
});
