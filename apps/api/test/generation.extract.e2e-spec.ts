import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Cv, GenerationJob } from '../src/db/entities.js';
import { JobEngine } from '../src/generation/job-engine.js';
import { entityManager, resetDatabase } from './support/db.js';
import { createCv, createJob, SAMPLE_SOURCE_TEXT } from './support/factories.js';
import { signIn, type TestSession } from './support/session.js';
import {
  extractorAnswer,
  judgeAnswer,
  pipelineHarness,
  SAMPLE_FACTS,
  writerAnswer,
} from './generation/pipeline-harness.js';

/** The extract step inside a job: the repair request goes through the client and its call budget. */
describe('generation: extract step with a repair request', () => {
  const harness = pipelineHarness();
  const { fake } = harness;
  let app: NestFastifyApplication;
  let engine: JobEngine;
  let owner: TestSession;

  beforeAll(async () => {
    app = await harness.start();
    engine = app.get(JobEngine);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    fake.reset();
    owner = await signIn(entityManager(app));
  });

  it('asks the extractor once more for a misquoted position and keeps it with its bullet', async () => {
    const misquoted = SAMPLE_FACTS.map((fact) =>
      fact.kind === 'position' ? { ...fact, quote: 'Senior Engineer at Acme, since 2021' } : fact,
    );
    fake
      .on(
        'extractor',
        extractorAnswer(
          { facts: misquoted },
          {
            fixes: [
              { key: 'g0p0', quote: 'Senior Engineer, Acme Corp, 2021 – present', value: null },
            ],
          },
        ),
      )
      .on('writer', writerAnswer())
      .on('judge', judgeAnswer());
    const em = entityManager(app);
    const cv = await createCv(em, {
      user: owner.user,
      targetRole: 'Engineer',
      source: { text: SAMPLE_SOURCE_TEXT },
    });
    const job = await createJob(em, { cv });

    await engine.processNext();

    const inputs = fake.inputs('extractor');
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toContain('<facts_to_fix>');
    expect(inputs[1]).toContain('This quote is not in the CV text');
    const stored = await em.fork().findOneOrFail(GenerationJob, { id: job.id });
    expect(stored).toMatchObject({ status: 'succeeded', llmCalls: 4 });
    expect(stored.state.extract).toMatchObject({ repaired: { asked: 1, fixed: 1 } });
    expect((stored.state.extract as { dropped: unknown }).dropped).toEqual({});
    const saved = await em.fork().findOneOrFail(Cv, { id: cv.id });
    expect(saved.document?.experience[0]).toMatchObject({
      company: 'Acme Corp',
      title: 'Senior Engineer',
      bullets: [{ factIds: ['f5'] }],
    });
  });
});
