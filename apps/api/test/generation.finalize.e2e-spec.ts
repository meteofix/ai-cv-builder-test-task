import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Cv, CvQuestion, CvSource, GenerationJob } from '../src/db/entities.js';
import { replaceDocument } from '../src/generation/generate/document-write.js';
import { sourceFactsSchema } from '../src/generation/generate/schemas.js';
import { removedProse } from '../src/generation/generate/source-facts.js';
import { JobError } from '../src/generation/job-errors.js';
import { JobEngine } from '../src/generation/job-engine.js';
import { entityManager, resetDatabase } from './support/db.js';
import { createCv, createJob, createUser, sampleDocument } from './support/factories.js';
import {
  extractorAnswer,
  judgeAnswer,
  pipelineHarness,
  SAMPLE_FACTS,
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
      .on(
        'extractor',
        extractorAnswer({
          facts: SAMPLE_FACTS.map((fact) =>
            fact.kind === 'position'
              ? { ...fact, position: { ...fact.position, current: false } }
              : fact,
          ),
        }),
      )
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

  it('gives the judge each item’s destination and where its quotes stand in the source', async () => {
    fake.on('extractor', extractorAnswer()).on('writer', writerAnswer()).on('judge', judgeAnswer());
    await queued();
    await app.get(JobEngine).processNext();
    const [judgeInput] = fake.inputs('judge');
    expect(judgeInput).toContain('"destination":"Senior Engineer — Acme Corp (2021 – ?)"');
    expect(judgeInput).toContain('"appearsUnder":"Senior Engineer — Acme Corp (2021 – ?)"');
    expect(judgeInput).toContain('"destination":"Summary"');
  });

  describe('a job marked current is judged', () => {
    const claim = (text: string) => text.startsWith('Still works in this role');

    it('asks the judge whether the job has not ended, with the position’s own quote', async () => {
      fake
        .on('extractor', extractorAnswer())
        .on('writer', writerAnswer())
        .on('judge', judgeAnswer());
      await queued();
      await app.get(JobEngine).processNext();
      const [judgeInput] = fake.inputs('judge');
      expect(judgeInput).toContain('Still works in this role');
      expect(judgeInput).toContain('"quote":"Senior Engineer, Acme Corp, 2021 – present"');
    });

    it('keeps a supported current job current, with no dates question', async () => {
      fake
        .on('extractor', extractorAnswer())
        .on('writer', writerAnswer())
        .on('judge', judgeAnswer());
      const { cv } = await queued();
      await app.get(JobEngine).processNext();
      const job = (await entityManager(app).findOneOrFail(Cv, cv.id)).document!.experience[0]!;
      expect(job).toMatchObject({ current: true, end: null });
      const questions = await entityManager(app).find(CvQuestion, { cv: cv.id });
      expect(questions.some((q) => q.target.field === 'dates')).toBe(false);
    });

    it('turns a rejected "still in this role" into a past job with a dates question', async () => {
      fake
        .on('extractor', extractorAnswer())
        .on('writer', writerAnswer())
        .on(
          'judge',
          judgeAnswer((item) => (claim(item.text) ? 'time_or_negation' : null)),
        );
      const { cv } = await queued();
      await app.get(JobEngine).processNext();
      const job = (await entityManager(app).findOneOrFail(Cv, cv.id)).document!.experience[0]!;
      expect(job).toMatchObject({ current: false, end: null, start: '2021' });
      const questions = await entityManager(app).find(CvQuestion, { cv: cv.id });
      expect(questions).toContainEqual(
        expect.objectContaining({
          kind: 'missing',
          answerType: 'dates',
          target: { section: 'experience', itemId: job.id, field: 'dates' },
        }),
      );
      // The claim is not prose that was left out: no "unverified" question or panel entry for it.
      expect(questions.some((q) => q.kind === 'unverified')).toBe(false);
      const removed = await removedProse(entityManager(app), cv.id);
      expect(removed.some((item) => claim(item.text))).toBe(false);
      // Stored as judged, so a later answer's writer does not see the job as current again.
      const stored = sourceFactsSchema.parse(
        (await entityManager(app).findOneOrFail(CvSource, { cv: cv.id })).facts,
      );
      expect(stored.facts.find((fact) => fact.kind === 'position')).toMatchObject({
        position: { current: false },
      });
    });

    it('fails closed: a current job without a verdict becomes a dates question too', async () => {
      fake
        .on('extractor', extractorAnswer())
        .on('writer', writerAnswer())
        .on(
          'judge',
          judgeAnswer(
            () => null,
            (item) => claim(item.text),
          ),
        );
      const { cv } = await queued();
      await app.get(JobEngine).processNext();
      const job = (await entityManager(app).findOneOrFail(Cv, cv.id)).document!.experience[0]!;
      expect(job).toMatchObject({ current: false, end: null });
    });
  });
});
