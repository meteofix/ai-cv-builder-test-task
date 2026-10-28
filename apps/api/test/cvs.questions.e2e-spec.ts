import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { problemSchema, ROUTES, routePath } from '@cv/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LockMode } from '@mikro-orm/core';
import { Cv, CvQuestion, GenerationJob } from '../src/db/entities.js';
import { createTestApp, inject } from './support/create-test-app.js';
import { entityManager, resetDatabase } from './support/db.js';
import { createCv, createQuestion, sampleDocument } from './support/factories.js';
import { signIn, type TestSession } from './support/session.js';

/** Question handling of docs/specs/cvs.md beyond the acceptance examples. */

describe('cvs questions', () => {
  let app: NestFastifyApplication;
  let session: TestSession;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    session = await signIn(entityManager(app));
  });

  const send = (method: 'GET' | 'POST', url: string, body?: unknown) =>
    inject(app, {
      method,
      url,
      headers: {
        ...session.headers,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });

  describe('routes', () => {
    let cv: Awaited<ReturnType<typeof createCv>>;
    const url = (path: string, qid: string, id = cv.id) => routePath(path, { id, qid });
    const answerText = (qid: string, text: string, id = cv.id) =>
      send('POST', url(ROUTES.answerQuestion.path, qid, id), { answer: { type: 'text', text } });

    beforeEach(async () => {
      cv = await createCv(entityManager(app), { user: session.user, document: sampleDocument() });
    });

    it('stores what the worker needs: the answer, the question id and the target', async () => {
      const em = entityManager(app);
      const question = await createQuestion(em, {
        cv,
        answerType: 'text',
        target: { section: 'summary' },
      });

      const res = await answerText(question.id, 'I led a team of five.');
      expect(res.statusCode).toBe(202);

      const job = await entityManager(app).findOneOrFail(GenerationJob, { cv: cv.id });
      expect(job).toMatchObject({
        kind: 'apply_answer',
        target: { questionId: question.id, section: 'summary' },
        payload: {
          questionId: question.id,
          answer: { type: 'text', text: 'I led a team of five.' },
        },
      });
    });

    it('refuses a NUL character in a text answer with 400 and keeps the question open', async () => {
      const question = await createQuestion(entityManager(app), { cv, answerType: 'text' });
      const res = await answerText(question.id, 'led a team\u0000 of five');
      expect(res.statusCode).toBe(400);
      expect(problemSchema.parse(res.json()).code).toBe('VALIDATION_FAILED');
      expect((await entityManager(app).findOneOrFail(CvQuestion, question.id)).status).toBe('open');
    });

    it('takes the six characters backslash-u-0-0-0-0 as text in an answer', async () => {
      const question = await createQuestion(entityManager(app), { cv, answerType: 'text' });
      const res = await answerText(question.id, String.raw`Handled \u0000 in parsers.`);
      expect(res.statusCode).toBe(202);
    });

    it('locks the CV row before the question row, so a delete cannot deadlock with an answer', async () => {
      const question = await createQuestion(entityManager(app), { cv, answerType: 'text' });
      let answering: ReturnType<typeof answerText> | undefined;
      // This transaction plays a DELETE: it holds the CV row and would take the question rows next.
      await entityManager(app).transactional(async (tx) => {
        await tx.findOneOrFail(Cv, cv.id, { lockMode: LockMode.PESSIMISTIC_WRITE });
        answering = answerText(question.id, 'An answer.');
        await new Promise((resolve) => setTimeout(resolve, 300));
        // The answer waits for the CV row and has not locked the question: this would fail at once otherwise.
        await tx.findOneOrFail(CvQuestion, question.id, {
          lockMode: LockMode.PESSIMISTIC_WRITE_OR_FAIL,
        });
      });
      expect((await answering)?.statusCode).toBe(202);
    });

    it.each([
      ['an answer over 1000 characters', 'x'.repeat(1001)],
      ['a blank answer', '   '],
    ])('refuses %s and keeps the question open', async (_case, text) => {
      const question = await createQuestion(entityManager(app), { cv, answerType: 'text' });
      const res = await answerText(question.id, text);
      expect(res.statusCode).toBe(400);
      expect((await entityManager(app).findOneOrFail(CvQuestion, question.id)).status).toBe('open');
    });

    it.each([
      ['a dismissed question', { status: 'dismissed' as const }],
      [
        'an answered question that was applied',
        { status: 'answered' as const, applyStatus: 'applied' as const },
      ],
      [
        'an answered question that is still applying',
        { status: 'answered' as const, applyStatus: 'applying' as const },
      ],
    ])('does not accept an answer for %s', async (_case, fields) => {
      const question = await createQuestion(entityManager(app), {
        cv,
        answerType: 'text',
        ...fields,
      });
      const res = await answerText(question.id, 'Another try.');
      expect(res.statusCode).toBe(409);
      expect(problemSchema.parse(res.json()).code).toBe('QUESTION_CLOSED');
    });

    it.each([
      ['a malformed id', 'not-a-uuid'],
      ['an unknown id', '00000000-0000-4000-8000-000000000000'],
    ])('answers QUESTION_NOT_FOUND for %s, on both routes', async (_case, qid) => {
      for (const route of [ROUTES.answerQuestion, ROUTES.dismissQuestion]) {
        const res = await send(
          'POST',
          url(route.path, qid),
          route === ROUTES.answerQuestion ? { answer: { type: 'text', text: 'x' } } : undefined,
        );
        expect(res.statusCode).toBe(404);
        expect(problemSchema.parse(res.json()).code).toBe('QUESTION_NOT_FOUND');
      }
    });

    it('lets one of two parallel answers to the same question win', async () => {
      const question = await createQuestion(entityManager(app), { cv, answerType: 'text' });
      const results = await Promise.all([
        answerText(question.id, 'First.'),
        answerText(question.id, 'Second.'),
      ]);
      expect(results.map((res) => res.statusCode).sort()).toEqual([202, 409]);
      // The loser waits for the winner's row lock and then sees an answered question.
      const loser = results.find((res) => res.statusCode === 409);
      expect(problemSchema.parse(loser?.json()).code).toBe('QUESTION_CLOSED');
      expect(await entityManager(app).count(GenerationJob, { cv: cv.id })).toBe(1);
    });

    it('does not dismiss a question whose application failed, so a retry cannot apply it later', async () => {
      const question = await createQuestion(entityManager(app), {
        cv,
        status: 'answered',
        applyStatus: 'failed',
      });
      const res = await send('POST', url(ROUTES.dismissQuestion.path, question.id));
      expect(res.statusCode).toBe(409);
      expect(problemSchema.parse(res.json()).code).toBe('QUESTION_CLOSED');
      expect((await entityManager(app).findOneOrFail(CvQuestion, question.id)).status).toBe(
        'answered',
      );
    });

    it('lets a dismiss and an answer race without both succeeding', async () => {
      const question = await createQuestion(entityManager(app), { cv, answerType: 'text' });
      const [dismissed, answered] = await Promise.all([
        send('POST', url(ROUTES.dismissQuestion.path, question.id)),
        answerText(question.id, 'An answer.'),
      ]);
      const stored = await entityManager(app).findOneOrFail(CvQuestion, question.id);
      const jobs = await entityManager(app).count(GenerationJob, { cv: cv.id });
      if (dismissed.statusCode === 200) {
        expect([answered.statusCode, stored.status, jobs]).toEqual([409, 'dismissed', 0]);
      } else {
        expect([dismissed.statusCode, answered.statusCode, stored.status, jobs]).toEqual([
          409,
          202,
          'answered',
          1,
        ]);
      }
    });

    it('scopes dismiss to the CV in the URL: a question of another CV is not found', async () => {
      const em = entityManager(app);
      const other = await createCv(em, { user: session.user, document: sampleDocument() });
      const foreign = await createQuestion(em, { cv: other });
      const res = await send('POST', url(ROUTES.dismissQuestion.path, foreign.id));
      expect(res.statusCode).toBe(404);
      expect(problemSchema.parse(res.json()).code).toBe('QUESTION_NOT_FOUND');
      expect((await entityManager(app).findOneOrFail(CvQuestion, foreign.id)).status).toBe('open');
    });

    it('lists both routes in Swagger, with a body for answer only', async () => {
      const res = await send('GET', '/api/docs-json');
      interface Operation {
        requestBody?: unknown;
      }
      const { paths } = res.json<{ paths: Record<string, Record<string, Operation>> }>();
      const operation = (route: { path: string; method: string }) =>
        paths[route.path.replace(/:(\w+)/g, '{$1}')]?.[route.method.toLowerCase()];
      expect(operation(ROUTES.answerQuestion)?.requestBody).toBeDefined();
      expect(operation(ROUTES.dismissQuestion)).toBeDefined();
      expect(operation(ROUTES.dismissQuestion)?.requestBody).toBeUndefined();
    });

    it('does not let a dismissed question be dismissed or answered again', async () => {
      const question = await createQuestion(entityManager(app), { cv, status: 'dismissed' });
      const res = await send('POST', url(ROUTES.dismissQuestion.path, question.id));
      expect(problemSchema.parse(res.json()).code).toBe('QUESTION_CLOSED');
    });
  });
});
