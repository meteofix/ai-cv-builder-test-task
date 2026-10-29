import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { bulletsOf, LIMITS, type Answer, type QuestionTarget } from '@cv/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Cv, CvQuestion, CvSource, GenerationJob, type IUser } from '../src/db/entities.js';
import { sourceFactsSchema } from '../src/generation/generate/schemas.js';
import { JobEngine } from '../src/generation/job-engine.js';
import { entityManager, resetDatabase } from './support/db.js';
import { createUser } from './support/factories.js';
import {
  answerAgain,
  answeredCv,
  POSITION_A,
  POSITION_B,
  writerFacts,
} from './generation/answer-fixture.js';
import type { FakeAnswer } from './generation/fake-llm.js';
import { judgeAnswer, pipelineHarness } from './generation/pipeline-harness.js';

/** `apply_answer` beyond the acceptance examples (docs/specs/generation.md §5). */
describe('apply_answer', () => {
  const harness = pipelineHarness();
  const { fake, clock } = harness;
  let app: NestFastifyApplication;
  let user: IUser;

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
    user = await createUser(entityManager(app));
  });

  const run = () => app.get(JobEngine).processNext();
  const cvRow = (id: string) => entityManager(app).findOneOrFail(Cv, id);
  const questionRow = (id: string) => entityManager(app).findOneOrFail(CvQuestion, id);
  const answersOf = async (cvId: string) =>
    sourceFactsSchema.parse((await entityManager(app).findOneOrFail(CvSource, { cv: cvId })).facts)
      .answers;
  const positionOf = async (cvId: string, id: string) =>
    (await cvRow(cvId)).document!.experience.find((job) => job.id === id)!;
  const answered = (target: QuestionTarget, answer: Answer) =>
    answeredCv(entityManager(app), user, { target, answer });
  /** A writer that cites every answer fact it was given (and `extra` ids) in each bullet. */
  const bullets =
    (texts: string[], extra: string[] = []): FakeAnswer =>
    (request) => {
      const answerIds = writerFacts(request)
        .filter((fact) => fact.id.startsWith('answer-'))
        .map((fact) => fact.id);
      return {
        output: { bullets: texts.map((text) => ({ text, factIds: [...answerIds, ...extra] })) },
      };
    };

  describe('without the LLM', () => {
    it.each([
      ['company', 'Acme Corporation'],
      ['title', 'Lead Engineer'],
      ['location', 'Lviv'],
    ])('sets the %s of a position from a text answer, trimmed', async (field, value) => {
      const { cv, question } = await answered(
        { section: 'experience', itemId: POSITION_A, field },
        { type: 'text', text: `  ${value}  ` },
      );
      await run();
      expect(fake.requests).toEqual([]);
      expect(await positionOf(cv.id, POSITION_A)).toMatchObject({ [field]: value });
      expect((await cvRow(cv.id)).version).toBe(2);
      expect((await questionRow(question.id)).applyStatus).toBe('applied');
    });

    it.each([
      ['institution', 'Kyiv Polytechnic'],
      ['degree', 'MSc Computer Science'],
    ])('sets the %s of an education entry', async (field, value) => {
      const em = entityManager(app);
      const { cv } = await answeredCv(
        em,
        user,
        {
          target: { section: 'education', itemId: 'e1', field },
          answer: { type: 'text', text: value },
        },
        (document) => ({ ...document, education: [{ id: 'e1', institution: 'KPI' }] }),
      );
      await run();
      expect((await cvRow(cv.id)).document!.education[0]).toMatchObject({ [field]: value });
    });

    it('sets education dates and clears the end of a current job', async () => {
      const em = entityManager(app);
      const school = await answeredCv(
        em,
        user,
        {
          target: { section: 'education', itemId: 'e1', field: 'dates' },
          answer: { type: 'dates', start: '2014', end: '2018', current: false },
        },
        (document) => ({ ...document, education: [{ id: 'e1', institution: 'KPI' }] }),
      );
      await run();
      expect((await cvRow(school.cv.id)).document!.education[0]).toMatchObject({
        start: '2014',
        end: '2018',
      });

      const current = await answered(
        { section: 'experience', itemId: POSITION_B, field: 'dates' },
        { type: 'dates', start: '2018', end: null, current: true },
      );
      await run();
      expect(await positionOf(current.cv.id, POSITION_B)).toMatchObject({
        start: '2018',
        end: null,
        current: true,
      });
    });

    // Questions about extra entries come from the review of an author-written CV (decision 036).
    it.each([
      [
        'dates',
        { type: 'dates' as const, start: '2021-04', end: null, current: true },
        { start: '2021-04', end: null },
      ],
      [
        'dates',
        { type: 'dates' as const, start: '2019', end: '2020-06', current: false },
        { start: '2019', end: '2020-06' },
      ],
      ['title', { type: 'text' as const, text: ' Proofing Timer ' }, { title: 'Proofing Timer' }],
    ])('sets the %s of an extra entry without the LLM', async (field, answer, expected) => {
      const entry = { id: 'a1-e1', title: '', start: null, end: null, groups: [] };
      const { cv, question } = await answeredCv(
        entityManager(app),
        user,
        { target: { section: 'additional', itemId: 'a1-e1', field }, answer },
        (document) => ({
          ...document,
          additional: [{ id: 'a1', title: 'Projects', entries: [entry] }],
        }),
      );
      await run();
      expect(fake.requests).toEqual([]);
      expect((await cvRow(cv.id)).document!.additional[0]!.entries[0]).toMatchObject(expected);
      expect((await questionRow(question.id)).applyStatus).toBe('applied');
    });

    it.each([
      [
        'a dates answer whose extra entry is gone',
        { section: 'additional' as const, itemId: 'a1-e9', field: 'dates' },
        { type: 'dates' as const, start: '2019', end: '2020', current: false },
        'The part of the CV this answer was for no longer exists.',
      ],
      [
        'a dates answer aimed at a whole extra section',
        { section: 'additional' as const, itemId: 'a1', field: 'dates' },
        { type: 'dates' as const, start: '2019', end: '2020', current: false },
        'This answer does not fit the part of the CV it was asked about.',
      ],
      [
        'a dates answer whose position is gone',
        { section: 'experience' as const, itemId: 'deleted', field: 'dates' },
        { type: 'dates' as const, start: '2019', end: null, current: true },
        'The part of the CV this answer was for no longer exists.',
      ],
      [
        'a text answer whose position is gone',
        { section: 'experience' as const, itemId: 'deleted' },
        { type: 'text' as const, text: 'I led a team.' },
        'The part of the CV this answer was for no longer exists.',
      ],
      [
        'a company answer aimed at an education entry',
        { section: 'education' as const, itemId: 'e1', field: 'company' },
        { type: 'text' as const, text: 'Acme' },
        'This answer does not fit the part of the CV it was asked about.',
      ],
    ])('changes nothing for %s and says why', async (_case, target, answer, note) => {
      const em = entityManager(app);
      const { cv, question, job } = await answeredCv(em, user, { target, answer }, (document) => ({
        ...document,
        education: [{ id: 'e1', institution: 'KPI' }],
        additional: [{ id: 'a1', title: 'Projects', entries: [] }],
      }));
      const before = await cvRow(cv.id);
      await run();
      expect(fake.requests).toEqual([]);
      expect((await entityManager(app).findOneOrFail(GenerationJob, job.id)).status).toBe(
        'succeeded',
      );
      const after = await cvRow(cv.id);
      expect(after.version).toBe(before.version);
      expect(after.document).toEqual(before.document);
      expect(await questionRow(question.id)).toMatchObject({
        applyStatus: 'failed',
        applyNote: note,
      });
    });
  });

  describe('regenerating content', () => {
    it('keeps the verified bullets when none of the new text passes, and keeps the answer', async () => {
      fake.on('writer', bullets(['Led a team of 12 engineers.'])).on('judge', judgeAnswer());
      const { cv, question } = await answered(
        { section: 'experience', itemId: POSITION_B },
        { type: 'text', text: 'I led a small team.' },
      );
      const before = await positionOf(cv.id, POSITION_B);
      await run();
      expect(fake.inputs('judge')).toEqual([]);
      expect(await positionOf(cv.id, POSITION_B)).toEqual(before);
      expect(await questionRow(question.id)).toMatchObject({
        applyStatus: 'partial',
        applyNote:
          'None of the new text could be verified, so this part of your CV was left as it was.',
      });
      expect(await answersOf(cv.id)).toHaveLength(1);
    });

    it('labels an answer fact for the judge as the user’s answer about its position', async () => {
      fake.on('writer', bullets(['Led a team.'])).on('judge', judgeAnswer());
      await answered(
        { section: 'experience', itemId: POSITION_A },
        { type: 'text', text: 'I led a team.' },
      );
      await run();
      const [judgeInput] = fake.inputs('judge');
      expect(judgeInput).toContain(
        '"appearsUnder":"the user\'s answer about Senior Engineer — Acme Corp (2021 – ?)"',
      );
      expect(judgeInput).toContain('"destination":"Senior Engineer — Acme Corp (2021 – ?)"');
    });

    it('never cuts the user’s own bullet when the regenerated ones fill the cap', async () => {
      // Letters, not numbers: a number the source does not contain would fail the number check.
      const full = Array.from(
        { length: LIMITS.maxBulletsPerPosition },
        (_, i) => `Thing ${String.fromCharCode(65 + i)}.`,
      );
      fake.on('writer', bullets(full)).on('judge', judgeAnswer());
      const { cv, question } = await answered(
        { section: 'experience', itemId: POSITION_A },
        { type: 'text', text: 'I did many things.' },
      );
      await run();
      expect(bulletsOf(await positionOf(cv.id, POSITION_A)).map((bullet) => bullet.text)).toEqual([
        ...full.slice(0, -1),
        'Wrote the onboarding guide.',
      ]);
      expect((await questionRow(question.id)).applyStatus).toBe('partial');
    });

    it('rejects a regenerated bullet without references, so it cannot pass as the user’s own', async () => {
      fake
        .on('writer', () => ({
          output: { bullets: [{ text: 'Unreferenced claim.', factIds: [] }] },
        }))
        .on('judge', judgeAnswer());
      const { cv } = await answered(
        { section: 'experience', itemId: POSITION_A },
        { type: 'text', text: 'I did things.' },
      );
      await run();
      const texts = bulletsOf(await positionOf(cv.id, POSITION_A)).map((bullet) => bullet.text);
      expect(texts).not.toContain('Unreferenced claim.');
    });

    it('regenerates only the summary for a summary question', async () => {
      const answer = 'I mentor junior engineers every week.';
      fake
        .on('writer', (request) => ({
          output: {
            summary: [
              {
                text: 'Engineer who mentors junior engineers.',
                factIds: writerFacts(request)
                  .filter((fact) => fact.quote === answer)
                  .map((fact) => fact.id),
              },
            ],
          },
        }))
        .on('judge', judgeAnswer());
      const { cv, question } = await answered(
        { section: 'summary' },
        { type: 'text', text: answer },
      );
      const before = (await cvRow(cv.id)).document!;
      await run();
      const after = (await cvRow(cv.id)).document!;
      expect(after.summary.text).toBe('Engineer who mentors junior engineers.');
      expect(after.experience).toEqual(before.experience);
      expect((await questionRow(question.id)).applyStatus).toBe('applied');
    });

    it('leaves a summary the user wrote themselves', async () => {
      fake
        .on('writer', () => ({ output: { summary: [{ text: 'New.', factIds: ['f1'] }] } }))
        .on('judge', judgeAnswer());
      const { cv, question } = await answeredCv(
        entityManager(app),
        user,
        { target: { section: 'summary' }, answer: { type: 'text', text: 'I mentor.' } },
        (document) => ({ ...document, summary: { text: 'My own words.', factIds: [] } }),
      );
      await run();
      expect((await cvRow(cv.id)).document!.summary.text).toBe('My own words.');
      expect(await questionRow(question.id)).toMatchObject({
        applyStatus: 'partial',
        applyNote: 'You wrote the summary yourself, so it was left as it was.',
      });
    });

    it('lets a later answer build on an earlier one, numbers included', async () => {
      fake
        .on('writer', bullets(['Led 7 engineers.']), bullets(['Led 7 engineers and hired 3 more.']))
        .on('judge', judgeAnswer());
      const first = await answered(
        { section: 'experience', itemId: POSITION_A },
        { type: 'text', text: 'I led 7 engineers.' },
      );
      await run();
      const second = await answerAgain(
        entityManager(app),
        first.cv,
        { section: 'experience', itemId: POSITION_A },
        { type: 'text', text: 'I hired 3 more engineers.' },
      );
      await run();

      expect((await answersOf(first.cv.id)).map((fact) => [fact.id, fact.quote])).toEqual([
        [`answer-${first.job.id}`, 'I led 7 engineers.'],
        [`answer-${second.job.id}`, 'I hired 3 more engineers.'],
      ]);
      const [, secondWriter] = fake.inputs('writer');
      expect(secondWriter).toContain('I led 7 engineers.');
      expect(secondWriter).toContain('I hired 3 more engineers.');
      // "7" is only in the first answer and "3" only in the second: both spans must point at the right text.
      expect(bulletsOf(await positionOf(first.cv.id, POSITION_A))[0]?.text).toBe(
        'Led 7 engineers and hired 3 more.',
      );
      expect((await questionRow(second.question.id)).applyStatus).toBe('applied');
    });
  });

  describe('lease and resume', () => {
    it('writes nothing when the lease is lost while the writer answers', async () => {
      const { cv, question, job } = await answered(
        { section: 'experience', itemId: POSITION_A },
        { type: 'text', text: 'I led a team.' },
      );
      fake
        .on('writer', async () => {
          await entityManager(app).nativeUpdate(
            GenerationJob,
            { id: job.id },
            { lockedBy: 'other' },
          );
          return bullets(['Led a team.']);
        })
        .on('judge', judgeAnswer());
      const before = await cvRow(cv.id);
      await run();
      expect(await cvRow(cv.id)).toMatchObject({
        version: before.version,
        document: before.document,
      });
      expect((await questionRow(question.id)).applyStatus).toBe('applying');
      expect(await answersOf(cv.id)).toEqual([]);
    });

    it('resumes at the judge without asking the writer again and stores the answer once', async () => {
      fake.on('writer', bullets(['Led a team.'])).on('judge', () => {
        throw new Error('worker killed');
      });
      const { cv, job } = await answered(
        { section: 'experience', itemId: POSITION_A },
        { type: 'text', text: 'I led a team.' },
      );
      await run();
      await entityManager(app).nativeUpdate(
        GenerationJob,
        { id: job.id },
        {
          status: 'running',
          lockedBy: 'dead-worker',
          lockedUntil: new Date(clock.now().getTime() - 1_000),
        },
      );
      fake.reset();
      fake.on('judge', judgeAnswer());
      clock.advance(60_000);
      await run();
      expect(fake.inputs('writer')).toEqual([]);
      expect((await entityManager(app).findOneOrFail(GenerationJob, job.id)).status).toBe(
        'succeeded',
      );
      expect(await answersOf(cv.id)).toHaveLength(1);
      expect(bulletsOf(await positionOf(cv.id, POSITION_A))[0]?.text).toBe('Led a team.');
    });
  });
});
