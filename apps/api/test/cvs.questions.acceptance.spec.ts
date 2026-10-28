import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { jobSchema, problemSchema, questionSchema, ROUTES, routePath } from '@cv/shared';
import { z } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CvQuestion, GenerationJob } from '../src/db/entities.js';
import { createTestApp, inject } from './support/create-test-app.js';
import { entityManager, resetDatabase } from './support/db.js';
import { createCv, createJob, createQuestion, sampleDocument } from './support/factories.js';
import { signIn, type TestSession } from './support/session.js';

/** Acceptance examples CVS-12, CVS-13, CVS-14 and CVS-17 of docs/specs/cvs.md: answering and dismissing questions. */

const answerResponse = z.object({ question: questionSchema, job: jobSchema });
const dismissResponse = z.object({ question: questionSchema });

describe('cvs acceptance: questions (docs/specs/cvs.md)', () => {
  let app: NestFastifyApplication;
  let session: TestSession;
  let cv: Awaited<ReturnType<typeof createCv>>;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    session = await signIn(entityManager(app));
    cv = await createCv(entityManager(app), { user: session.user, document: sampleDocument() });
  });

  const post = (path: string, id: string, qid: string, body?: unknown) =>
    inject(app, {
      method: 'POST',
      url: routePath(path, { id, qid }),
      headers: {
        ...session.headers,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
  const answer = (qid: string, body: unknown, id = cv.id) =>
    post(ROUTES.answerQuestion.path, id, qid, body);
  const dismiss = (qid: string, id = cv.id) => post(ROUTES.dismissQuestion.path, id, qid);

  const datesAnswer = { type: 'dates', start: '2021-03', end: null, current: true } as const;
  const target = { section: 'experience', itemId: 'p1', field: 'dates' } as const;
  const problemCode = (res: { json: () => unknown }) => problemSchema.parse(res.json()).code;

  it('CVS-12 — answering a question queues a targeted job', async () => {
    const em = entityManager(app);
    const question = await createQuestion(em, { cv, target });
    const second = await createQuestion(em, { cv });

    const res = await answer(question.id, { answer: datesAnswer });
    expect(res.statusCode).toBe(202);
    const body = answerResponse.parse(res.json());
    expect(body.question).toMatchObject({
      id: question.id,
      status: 'answered',
      applyStatus: 'applying',
      answer: datesAnswer,
    });
    expect(body.job).toEqual({
      id: body.job.id,
      kind: 'apply_answer',
      status: 'queued',
      step: null,
      target: { questionId: question.id, section: 'experience', itemId: 'p1' },
    });

    const again = await answer(question.id, { answer: datesAnswer });
    expect(again.statusCode).toBe(409);
    expect(problemCode(again)).toBe('QUESTION_CLOSED');

    const blocked = await answer(second.id, { answer: datesAnswer });
    expect(blocked.statusCode).toBe(409);
    expect(problemCode(blocked)).toBe('JOB_ACTIVE');
    const stored = await entityManager(app).findOneOrFail(CvQuestion, second.id);
    expect(stored).toMatchObject({ status: 'open', answer: null, applyStatus: null });
  });

  describe('CVS-13 — wrong answers', () => {
    it('a text answer to a dates question is a validation error', async () => {
      const question = await createQuestion(entityManager(app), { cv, target });
      const res = await answer(question.id, { answer: { type: 'text', text: 'March 2021' } });
      expect(res.statusCode).toBe(400);
      expect(problemCode(res)).toBe('VALIDATION_FAILED');
      expect((await entityManager(app).findOneOrFail(CvQuestion, question.id)).status).toBe('open');
      expect(await entityManager(app).count(GenerationJob, { cv: cv.id })).toBe(0);
    });

    it('a question of another CV of the same user is QUESTION_NOT_FOUND', async () => {
      const em = entityManager(app);
      const other = await createCv(em, { user: session.user, document: sampleDocument() });
      const foreign = await createQuestion(em, { cv: other });
      const res = await answer(foreign.id, { answer: datesAnswer });
      expect(res.statusCode).toBe(404);
      expect(problemCode(res)).toBe('QUESTION_NOT_FOUND');
    });
  });

  it('CVS-14 — dismiss', async () => {
    const em = entityManager(app);
    const question = await createQuestion(em, { cv });
    await createJob(em, { cv, kind: 'apply_answer', status: 'running' });

    const res = await dismiss(question.id);
    expect(res.statusCode).toBe(200);
    expect(dismissResponse.parse(res.json()).question.status).toBe('dismissed');

    const again = await dismiss(question.id);
    expect(again.statusCode).toBe(409);
    expect(problemCode(again)).toBe('QUESTION_CLOSED');
  });

  it('CVS-17 — a failed application can be answered again', async () => {
    const em = entityManager(app);
    const question = await createQuestion(em, {
      cv,
      target,
      status: 'answered',
      answer: { type: 'dates', start: '2020', end: null, current: true },
      applyStatus: 'failed',
      applyNote: 'The document changed.',
    });
    await createJob(em, { cv, kind: 'apply_answer', status: 'failed', errorCode: 'INTERNAL' });

    const res = await answer(question.id, { answer: datesAnswer });
    expect(res.statusCode).toBe(202);
    const body = answerResponse.parse(res.json());
    expect(body.question).toMatchObject({
      status: 'answered',
      applyStatus: 'applying',
      answer: datesAnswer,
      applyNote: null,
    });
    expect(body.job).toMatchObject({ kind: 'apply_answer', status: 'queued' });
    const jobs = await entityManager(app).find(GenerationJob, { cv: cv.id, status: 'queued' });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      kind: 'apply_answer',
      target: { questionId: question.id, section: 'experience', itemId: 'p1' },
      payload: { questionId: question.id, answer: datesAnswer },
    });
    expect(await entityManager(app).count(GenerationJob, { cv: cv.id })).toBe(2);
  });
});
