import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { problemSchema, ROUTES, routePath, type ApiRoute, type RouteName } from '@cv/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
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
 * A route that is not registered in this branch yet is reported as such; after the merge every route runs.
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

const cvRoutes = Object.entries(ROUTES).filter(([, route]) => route.path.includes(':id')) as [
  RouteName,
  ApiRoute,
][];

describe('ownership: a foreign CV id is 404 CV_NOT_FOUND', () => {
  let attacker: TestSession;
  let ids: { id: string; qid: string };

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
  });

  it.each(cvRoutes)('%s', async (name, route) => {
    if (!registered.has(`${route.method} ${route.path}`)) {
      // Not implemented in this branch; the route table test below keeps this list honest.
      expect(registered.has(`${route.method} ${route.path}`)).toBe(false);
      return;
    }
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

  it('sees the routes the app registers', () => {
    expect(registered.has('GET /api/health/live')).toBe(true);
  });
});
