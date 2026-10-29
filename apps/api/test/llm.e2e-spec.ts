import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GenerationJob, type IGenerationJob } from '../src/db/entities.js';
import { LLM_SLEEP, LlmClient } from '../src/llm/llm-client.js';
import { createTestApp } from './support/create-test-app.js';
import { entityManager, resetDatabase } from './support/db.js';
import { createCv, createJob, createUser } from './support/factories.js';
import { answer, fakeAnthropic } from './llm/fake-anthropic.js';

/** Answers Postgres could not store (docs/specs/generation.md §2.5), against the production SDK client. */
describe('LLM client: answers that cannot be stored', () => {
  let server: Awaited<ReturnType<typeof fakeAnthropic>>;
  let app: NestFastifyApplication;
  let job: IGenerationJob;
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
    job = await createJob(em, {
      cv: await createCv(em, { user: await createUser(em) }),
      status: 'running',
      lockedBy: 'worker-1',
    });
  });

  const parse = () =>
    app.get(LlmClient).parse({
      role: 'reviewer',
      system: 'You write.',
      input: '<cv_source>x</cv_source>',
      schema: z.object({ summary: z.string() }),
      job: { id: job.id, lockedBy: 'worker-1' },
      signal: new AbortController().signal,
    });
  const lastUserTurn = () =>
    JSON.stringify((server.requests.at(-1)?.body.messages as unknown[] | undefined)?.at(-1));

  it.each([
    ['a NUL character', 'Engi\u0000neer.'],
    ['a lone surrogate', 'Engi\ud800neer.'],
  ])('re-asks an answer with %s', async (_case, text) => {
    server.reply(answer({ summary: text }), answer({ summary: 'Engineer.' }));
    await expect(parse()).resolves.toEqual({ summary: 'Engineer.' });
    expect(server.requests).toHaveLength(2);
    expect(lastUserTurn()).toContain('NUL character');
    expect((await entityManager(app).findOneOrFail(GenerationJob, job.id)).llmCalls).toBe(2);
  });

  it('accepts the six characters \\u0000 typed as text', async () => {
    server.reply(answer({ summary: 'Handled \\u0000 escapes in the parser.' }));
    await expect(parse()).resolves.toEqual({ summary: 'Handled \\u0000 escapes in the parser.' });
    expect(server.requests).toHaveLength(1);
  });
});
