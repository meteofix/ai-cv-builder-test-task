import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ROUTES, routePath } from '@cv/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JobEngine } from '../src/generation/job-engine.js';
import { inject } from './support/create-test-app.js';
import { entityManager, resetDatabase } from './support/db.js';
import { createCv, createJob, sampleDocument } from './support/factories.js';
import { signIn, type TestSession } from './support/session.js';
import {
  extractorAnswer,
  judgeAnswer,
  pipelineHarness,
  writerAnswer,
} from './generation/pipeline-harness.js';

/** `GET /draft` and `GET /not-in-cv` before facts exist and after the document exists (generation.md §4). */
describe('draft and not-in-cv endpoints', () => {
  const harness = pipelineHarness();
  const { fake } = harness;
  let app: NestFastifyApplication;
  let owner: TestSession;

  beforeAll(async () => {
    app = await harness.start();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    fake.reset();
    owner = await signIn(entityManager(app));
  });

  const get = (route: 'getDraft' | 'getNotInCv', id: string) =>
    inject(app, {
      method: 'GET',
      url: routePath(ROUTES[route].path, { id }),
      headers: owner.headers,
    });

  it('has no draft and nothing left out before the facts are extracted', async () => {
    const cv = await createCv(entityManager(app), { user: owner.user });
    expect((await get('getDraft', cv.id)).json()).toEqual({ draft: null });
    expect((await get('getNotInCv', cv.id)).json()).toEqual({ items: [] });
  });

  it('has no draft once the CV has a document, even when facts exist', async () => {
    const em = entityManager(app);
    const cv = await createCv(em, { user: owner.user });
    await createJob(em, { cv });
    fake.on('extractor', extractorAnswer()).on('writer', writerAnswer()).on('judge', judgeAnswer());
    await app.get(JobEngine).processNext();
    expect((await get('getDraft', cv.id)).json()).toEqual({ draft: null });
  });

  it('has no draft for a CV whose document was written without a generation', async () => {
    const cv = await createCv(entityManager(app), { user: owner.user, document: sampleDocument() });
    expect((await get('getDraft', cv.id)).json()).toEqual({ draft: null });
  });

  it.each(['getDraft', 'getNotInCv'] as const)(
    '%s answers 404 CV_NOT_FOUND for a foreign CV',
    async (route) => {
      const stranger = await signIn(entityManager(app));
      const cv = await createCv(entityManager(app), { user: stranger.user });
      const res = await get(route, cv.id);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ code: 'CV_NOT_FOUND' });
    },
  );
});
