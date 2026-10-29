import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ROUTES, routePath, type Answer } from '@cv/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CvQuestion, GenerationJob, GenerationUsage } from '../src/db/entities.js';
import { createTestApp, inject } from './support/create-test-app.js';
import { entityManager, resetDatabase } from './support/db.js';
import { createCv, createQuestion, sampleDocument } from './support/factories.js';
import { signIn } from './support/session.js';

/** A text answer is a model call and spends the daily limit; a dates answer does not (docs/specs/cvs.md §8). */

describe('answering a question at the daily limit', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp({ GENERATIONS_PER_USER_PER_DAY: 1, GENERATIONS_TOTAL: 10 });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
  });

  async function answerAtLimit(answerType: 'text' | 'dates', answer: Answer) {
    const session = await signIn(entityManager(app));
    const em = entityManager(app);
    const cv = await createCv(em, { user: session.user, document: sampleDocument() });
    const question = await createQuestion(em, {
      cv,
      answerType,
      target:
        answerType === 'dates'
          ? { section: 'experience', itemId: 'p1', field: 'dates' }
          : { section: 'summary' },
    });
    em.create(GenerationUsage, { user: session.user.id });
    await em.flush();
    const response = await inject(app, {
      method: 'POST',
      url: routePath(ROUTES.answerQuestion.path, { id: cv.id, qid: question.id }),
      headers: { ...session.headers, 'content-type': 'application/json' },
      payload: JSON.stringify({ answer }),
    });
    return { response, question, cv };
  }

  it('refuses a text answer with 429 and leaves the question open', async () => {
    const { response, question, cv } = await answerAtLimit('text', {
      type: 'text',
      text: 'I mentored five designers.',
    });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ code: 'GENERATION_LIMIT_REACHED' });
    const stored = await entityManager(app).findOneOrFail(CvQuestion, question.id);
    expect(stored).toMatchObject({ status: 'open', answer: null });
    expect(await entityManager(app).count(GenerationJob, { cv: cv.id })).toBe(0);
    expect(await entityManager(app).count(GenerationUsage, {})).toBe(1);
  });

  it('still accepts a dates answer, which makes no model call', async () => {
    const { response, cv } = await answerAtLimit('dates', {
      type: 'dates',
      start: '2021-03',
      end: null,
      current: true,
    });
    expect(response.statusCode).toBe(202);
    expect(await entityManager(app).count(GenerationJob, { cv: cv.id })).toBe(1);
    expect(await entityManager(app).count(GenerationUsage, {})).toBe(1);
  });
});
