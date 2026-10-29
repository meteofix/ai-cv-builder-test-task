import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Cv, CvQuestion, GenerationJob } from '../src/db/entities.js';
import { replaceDocument } from '../src/generation/generate/document-write.js';
import { JobError } from '../src/generation/job-errors.js';
import { JobEngine } from '../src/generation/job-engine.js';
import { entityManager, resetDatabase } from './support/db.js';
import { createCv, createJob, createUser, sampleDocument } from './support/factories.js';
import {
  extractorAnswer,
  judgeAnswer,
  pipelineHarness,
  writerAnswer,
} from './generation/pipeline-harness.js';

/** Details of the judge step and finalize (docs/specs/generation.md §3.3, §3.4, §3.6). */
describe('generation finalize', () => {
  const harness = pipelineHarness();
  const { fake } = harness;
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
  });

  async function queued() {
    const em = entityManager(app);
    const cv = await createCv(em, { user: await createUser(em) });
    const job = await createJob(em, { cv });
    return { cv, job };
  }

  it('makes no judge call when the mechanical checks removed every item', async () => {
    fake
      .on('extractor', extractorAnswer())
      .on(
        'writer',
        writerAnswer({
          summary: [{ text: 'Seasoned engineer.', factIds: [] }],
          positions: [
            { positionId: 'f4', bullets: [{ text: 'Cut costs by 40%.', factIds: ['f5'] }] },
          ],
        }),
      )
      .on('judge', judgeAnswer());
    const { cv, job } = await queued();
    await app.get(JobEngine).processNext();

    expect(fake.inputs('judge')).toEqual([]);
    expect(await entityManager(app).findOneOrFail(GenerationJob, job.id)).toMatchObject({
      status: 'succeeded',
      llmCalls: 2,
    });
    const questions = await entityManager(app).find(CvQuestion, { cv: cv.id });
    expect(
      questions
        .filter((q) => q.kind === 'unverified')
        .map((q) => q.context)
        .sort(),
    ).toEqual(['Cut costs by 40%.', 'Seasoned engineer.']);
  });

  it('stores the questions with strictly increasing times in priority order', async () => {
    fake
      .on('extractor', extractorAnswer())
      .on(
        'writer',
        writerAnswer({
          positions: [
            { positionId: 'f4', bullets: [{ text: 'Cut costs by 40%.', factIds: ['f5'] }] },
          ],
        }),
      )
      .on('judge', judgeAnswer());
    const { cv } = await queued();
    await app.get(JobEngine).processNext();

    const questions = await entityManager(app).find(
      CvQuestion,
      { cv: cv.id },
      { orderBy: { createdAt: 'asc' } },
    );
    // The removed bullet comes first, then the position left without bullets.
    expect(questions.map((q) => [q.kind, q.target.field ?? null])).toEqual([
      ['unverified', null],
      ['missing', null],
    ]);
    const times = questions.map((q) => q.createdAt.getTime());
    expect(times.every((time, i) => i === 0 || time > (times[i - 1] ?? 0))).toBe(true);
  });

  it('refuses to replace a document whose version changed, as a retryable failure', async () => {
    const em = entityManager(app);
    const cv = await createCv(em, { user: await createUser(em), document: sampleDocument() });
    await em.nativeUpdate(Cv, { id: cv.id }, { version: cv.version + 1 });

    const write = entityManager(app).transactional((tx) =>
      replaceDocument(tx, cv, sampleDocument({ headline: 'Stale' }), new Date()),
    );
    await expect(write).rejects.toSatisfy(
      (error) => error instanceof JobError && error.code === 'INTERNAL' && error.retryable,
    );
    expect((await entityManager(app).findOneOrFail(Cv, cv.id)).document?.headline).not.toBe(
      'Stale',
    );
  });
});
