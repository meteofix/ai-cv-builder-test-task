import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JobEngine } from '../src/generation/job-engine.js';
import { entityManager, resetDatabase } from './support/db.js';
import { createCv, createJob } from './support/factories.js';
import { signIn } from './support/session.js';
import { pipelineHarness } from './generation/pipeline-harness.js';
import { NO_ISSUES, sampleAuthorAnswer } from './generation/author-answers.js';
import { answeredCv, GROUP_A1 } from './generation/answer-fixture.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Years of experience are counted up to the month of the job's clock (generation.md §3). */
describe('the current month in a generation', () => {
  const harness = pipelineHarness();
  const { fake, clock } = harness;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await harness.start();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    fake.reset();
    clock.reset();
  });

  it("gives the author and the reviewer the month of the job's clock, not of the wall clock", async () => {
    // Far enough ahead that the month differs from today's in any month of the year.
    clock.advance(400 * DAY_MS);
    const month = clock.now().toISOString().slice(0, 7);
    const em = entityManager(app);
    const { user } = await signIn(em);
    await createJob(em, { cv: await createCv(em, { user }) });
    fake.on('author', { output: sampleAuthorAnswer() }).on('reviewer', { output: NO_ISSUES });
    await app.get(JobEngine).processNext();

    const inputs = [...fake.inputs('author'), ...fake.inputs('reviewer')];
    expect(inputs).toHaveLength(2);
    for (const input of inputs) {
      expect(input).toContain(`<current_month>${month}</current_month>`);
    }
  });

  it("gives the author and the reviewer of an answer the month of the job's clock", async () => {
    clock.advance(400 * DAY_MS);
    const month = clock.now().toISOString().slice(0, 7);
    const em = entityManager(app);
    const { user } = await signIn(em);
    await answeredCv(em, user, {
      target: { section: 'experience', itemId: GROUP_A1 },
      answer: { type: 'text', text: 'I led a team of five engineers.' },
    });
    fake
      .on('author', {
        output: { items: [{ text: 'Led a team of five engineers', segments: ['S3', 'A1'] }] },
      })
      .on('reviewer', { output: NO_ISSUES });
    await app.get(JobEngine).processNext();

    const inputs = [...fake.inputs('author'), ...fake.inputs('reviewer')];
    expect(inputs).toHaveLength(2);
    for (const input of inputs) {
      expect(input).toContain(`<current_month>${month}</current_month>`);
    }
  });
});
