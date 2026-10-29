import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ROUTES, routePath } from '@cv/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JobEngine } from '../src/generation/job-engine.js';
import { inject } from './support/create-test-app.js';
import { entityManager, resetDatabase } from './support/db.js';
import { createCv, createJob, SAMPLE_SOURCE_TEXT, sampleDocument } from './support/factories.js';
import { signIn, type TestSession } from './support/session.js';
import { pipelineHarness } from './generation/pipeline-harness.js';
import { NO_ISSUES, sampleAuthorAnswer } from './generation/author-answers.js';

/** `GET /draft` and `GET /not-in-cv` before and after a generation (generation.md §4). */
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

  it('has no draft and nothing left out before a generation ends', async () => {
    const cv = await createCv(entityManager(app), { user: owner.user });
    expect((await get('getDraft', cv.id)).json()).toEqual({ draft: null });
    expect((await get('getNotInCv', cv.id)).json()).toEqual({ items: [] });
  });

  it('has no draft once the CV has a document', async () => {
    const em = entityManager(app);
    const cv = await createCv(em, { user: owner.user });
    await createJob(em, { cv });
    fake.on('author', { output: sampleAuthorAnswer() }).on('reviewer', { output: NO_ISSUES });
    await app.get(JobEngine).processNext();
    expect((await get('getDraft', cv.id)).json()).toEqual({ draft: null });
    // The sample answer cites every content segment: nothing to warn about.
    expect((await get('getNotInCv', cv.id)).json()).toMatchObject({
      sourceCoverage: { notRecognized: 0, low: false },
    });
  });

  it("serves the author's reason for an older job first, and nothing when the order is newest first", async () => {
    const em = entityManager(app);
    const cv = await createCv(em, { user: owner.user });
    await createJob(em, { cv });
    const reason = 'The design work fits the role better than the later sales job.';
    fake
      .on('author', { output: sampleAuthorAnswer({ orderReason: reason }) })
      .on('reviewer', { output: NO_ISSUES });
    await app.get(JobEngine).processNext();
    expect((await get('getNotInCv', cv.id)).json()).toMatchObject({ orderReason: reason });

    const plain = await createCv(em, { user: owner.user });
    await createJob(em, { cv: plain });
    fake.on('author', { output: sampleAuthorAnswer() });
    await app.get(JobEngine).processNext();
    expect((await get('getNotInCv', plain.id)).json()).not.toHaveProperty('orderReason');
  });

  it("never serves the author's structure notes: they are for evals, not for the person", async () => {
    const em = entityManager(app);
    const cv = await createCv(em, { user: owner.user });
    await createJob(em, { cv });
    const notes = 'Merged a subsection repeated after a page break into its first part.';
    fake
      .on('author', { output: sampleAuthorAnswer({ structureNotes: notes }) })
      .on('reviewer', { output: NO_ISSUES });
    await app.get(JobEngine).processNext();
    expect((await get('getNotInCv', cv.id)).body).not.toContain('page break');
  });

  it('says when most of the source was not recognized', async () => {
    const em = entityManager(app);
    const unread = Array.from({ length: 30 }, (_, i) => `Line ${i + 1} nobody cited`).join('\n');
    const cv = await createCv(em, {
      user: owner.user,
      source: { text: `${SAMPLE_SOURCE_TEXT}\n${unread}` },
    });
    await createJob(em, { cv });
    fake.on('author', { output: sampleAuthorAnswer() }).on('reviewer', { output: NO_ISSUES });
    await app.get(JobEngine).processNext();
    expect((await get('getNotInCv', cv.id)).json()).toMatchObject({
      sourceCoverage: { notRecognized: 30, low: true },
    });
  });

  it('shows nothing left out for a CV whose stored analysis cannot be read', async () => {
    const cv = await createCv(entityManager(app), {
      user: owner.user,
      document: sampleDocument(),
      source: { text: SAMPLE_SOURCE_TEXT, facts: { locale: 'en', facts: [] } },
    });
    expect((await get('getNotInCv', cv.id)).json()).toEqual({ items: [] });
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
