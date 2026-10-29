import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { problemSchema, ROUTES, routePath, type ApiRoute, type RouteName } from '@cv/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Cv, CvQuestion, CvSource, GenerationJob, GenerationUsage } from '../src/db/entities.js';
import { createTestApp, inject } from './support/create-test-app.js';
import { entityManager, resetDatabase } from './support/db.js';
import {
  createCv,
  createJob,
  createQuestion,
  createUser,
  sampleDocument,
} from './support/factories.js';
import { signIn, type TestSession } from './support/session.js';

/**
 * Isolation table (spec: docs/specs/cvs.md, "Ownership"): a second account gets 404 CV_NOT_FOUND on every
 * route with a CV id. Bodies are valid, otherwise a 400 from validation would hide a missing owner check.
 * Every such route must be registered: a route of the table without a handler fails here, not silently.
 */
const VALID_BODIES: Partial<Record<RouteName, () => unknown>> = {
  updateDocument: () => ({ document: sampleDocument(), version: 1 }),
  answerQuestion: () => ({ answer: { type: 'text', text: 'I led a team of five.' } }),
};

const registered = new Set<string>();
const app: NestFastifyApplication = await createTestApp(
  {},
  {
    beforeInit: (nest) => {
      nest
        .getHttpAdapter()
        .getInstance()
        .addHook('onRoute', (route) => {
          const methods = Array.isArray(route.method) ? route.method : [route.method];
          for (const method of methods) registered.add(`${method} ${route.url}`);
        });
    },
  },
);

// Any parameter right after /api/cvs/ is a CV id, whatever its name; routePath throws if this table cannot fill it.
const cvRoutes = Object.entries(ROUTES).filter(([, route]) =>
  route.path.startsWith('/api/cvs/:'),
) as [RouteName, ApiRoute][];

describe('ownership: a foreign CV id is 404 CV_NOT_FOUND', () => {
  let attacker: TestSession;
  let ids: { id: string; qid: string };
  let before: Awaited<ReturnType<typeof victimState>>;

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    const em = entityManager(app);
    // The victim's CV is in a state where every route would succeed for its owner.
    const cv = await createCv(em, { user: await createUser(em), document: sampleDocument() });
    const question = await createQuestion(em, { cv });
    await createJob(em, { cv, status: 'failed', errorCode: 'AI_UNAVAILABLE' });
    ids = { id: cv.id, qid: question.id };
    attacker = await signIn(em);
    before = await victimState();
  });

  /** Everything an attacker's request could change about the victim's CV. */
  async function victimState() {
    const em = entityManager(app);
    const cv = await em.findOne(Cv, ids.id);
    const questions = await em.find(CvQuestion, { cv: ids.id });
    const jobs = await em.find(GenerationJob, { cv: ids.id });
    return {
      cv: cv && { version: cv.version, document: cv.document, updatedAt: cv.updatedAt },
      source: await em.count(CvSource, { cv: ids.id }),
      questions: questions.map(({ status, answer, applyStatus }) => ({
        status,
        answer,
        applyStatus,
      })),
      jobs: jobs.map(({ status, attempts, llmCalls, lockedBy }) => ({
        status,
        attempts,
        llmCalls,
        lockedBy,
      })),
      usage: await em.count(GenerationUsage, {}),
    };
  }

  it.each(cvRoutes)('%s', async (name, route) => {
    expect([...registered]).toContain(`${route.method} ${route.path}`);
    const body = VALID_BODIES[name]?.();
    const res = await inject(app, {
      method: route.method,
      url: routePath(route.path, ids),
      headers: {
        ...attacker.headers,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
    expect(res.statusCode).toBe(404);
    expect(problemSchema.parse(res.json()).code).toBe('CV_NOT_FOUND');
    // A handler that writes before it checks the owner would still answer 404.
    expect(await victimState()).toEqual(before);
  });

  it('has a valid body for every CV route that takes one', () => {
    const needBody = cvRoutes.filter(([, route]) => route.body).map(([name]) => name);
    expect(needBody.filter((name) => !VALID_BODIES[name])).toEqual([]);
  });
});

describe('route table', () => {
  it('lists every registered API route in ROUTES of @cv/shared', () => {
    const known = new Set(Object.values(ROUTES).map((route) => `${route.method} ${route.path}`));
    const unknown = [...registered].filter(
      (key) =>
        /^(GET|POST|PUT|PATCH|DELETE) \/api\//.test(key) &&
        !/ \/api\/(docs|health)(\/|$)/.test(key) &&
        !known.has(key),
    );
    expect(unknown).toEqual([]);
  });

  it('registers a handler for every route of ROUTES', () => {
    const missing = Object.values(ROUTES)
      .map((route) => `${route.method} ${route.path}`)
      .filter((key) => !registered.has(key));
    expect(missing).toEqual([]);
  });

  it('sees the routes the app registers', () => {
    expect(registered.has('GET /api/health/live')).toBe(true);
  });
});
