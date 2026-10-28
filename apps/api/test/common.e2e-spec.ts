import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OwnedCvs } from '../src/common/owned-cvs.js';
import { createTestApp, inject } from './support/create-test-app.js';
import { entityManager, resetDatabase } from './support/db.js';
import { createCv, createUser } from './support/factories.js';
import { ProbeModule } from './support/probe.module.js';
import { sessionHeaders, signIn } from './support/session.js';

describe('session guard, @CurrentUser() and findOwned', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp({}, { imports: [ProbeModule] });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
  });

  describe('deny by default', () => {
    it.each([
      ['no cookie', {}],
      ['an unknown token', sessionHeaders('not-a-session')],
      ['an empty cookie', { cookie: 'sid=' }],
    ])('answers 401 to %s', async (_case, headers) => {
      const res = await inject(app, { method: 'GET', url: '/api/probe/me', headers });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('answers 401 to an expired session', async () => {
      const { headers } = await signIn(entityManager(app), undefined, {
        expiresAt: new Date(Date.now() - 1000),
      });
      const res = await inject(app, { method: 'GET', url: '/api/probe/me', headers });
      expect(res.statusCode).toBe(401);
    });

    it('lets a @Public() route through without a session', async () => {
      const res = await inject(app, { method: 'GET', url: '/api/probe/ip' });
      expect(res.statusCode).toBe(200);
    });
  });

  it('hands the signed-in user to @CurrentUser()', async () => {
    const em = entityManager(app);
    const user = await createUser(em, { email: 'owner@example.com' });
    const { headers } = await signIn(em, user);
    const res = await inject(app, { method: 'GET', url: '/api/probe/me', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: user.id, email: 'owner@example.com' });
  });

  it('reads the session cookie among other cookies', async () => {
    const { headers } = await signIn(entityManager(app));
    const res = await inject(app, {
      method: 'GET',
      url: '/api/probe/me',
      headers: { ...headers, cookie: `theme=dark; ${headers.cookie}; lang=en` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('passes CSRF on a POST with the session helper headers, and only with them', async () => {
    const { headers } = await signIn(entityManager(app));
    const sameOrigin = await inject(app, { method: 'POST', url: '/api/probe/me', headers });
    expect(sameOrigin.statusCode).toBe(201);
    const crossSite = await inject(app, {
      method: 'POST',
      url: '/api/probe/me',
      headers: { ...headers, 'sec-fetch-site': 'cross-site' },
    });
    expect(crossSite.statusCode).toBe(403);
  });

  describe('findOwned', () => {
    it('returns the CV to its owner', async () => {
      const em = entityManager(app);
      const { user, headers } = await signIn(em);
      const cv = await createCv(em, { user });
      const res = await inject(app, { method: 'GET', url: `/api/probe/cvs/${cv.id}`, headers });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ id: cv.id });
    });

    it.each([
      ['another user’s CV', 'foreign'],
      ['a missing id', 'missing'],
      ['a malformed id', 'malformed'],
    ])('answers 404 to %s', async (_case, kind) => {
      const em = entityManager(app);
      const { headers } = await signIn(em);
      const foreign = await createCv(em, { user: await createUser(em) });
      const id = { foreign: foreign.id, missing: randomUUID(), malformed: 'not-a-uuid' }[kind];
      const res = await inject(app, { method: 'GET', url: `/api/probe/cvs/${id}`, headers });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ code: 'CV_NOT_FOUND' });
    });
  });
});

describe('trustProxy wiring', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp({}, { imports: [ProbeModule] });
  });
  afterAll(async () => {
    await app.close();
  });

  async function ipSeen(remoteAddress: string) {
    const res = await inject(app, {
      method: 'GET',
      url: '/api/probe/ip',
      remoteAddress,
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });
    return res.json<{ ip: string }>().ip;
  }

  it('takes the client address from X-Forwarded-For sent by a proxy on a private address', async () => {
    expect(await ipSeen('172.18.0.5')).toBe('203.0.113.9');
  });

  it('ignores X-Forwarded-For from a public address', async () => {
    expect(await ipSeen('198.51.100.7')).toBe('198.51.100.7');
  });
});

describe('provider overrides in createTestApp', () => {
  it('replaces a provider with a test double while keeping the real wiring', async () => {
    const fake = { findOwned: (id: string) => Promise.resolve({ id: `fake-${id}` }) };
    const app = await createTestApp(
      {},
      { imports: [ProbeModule], overrides: [{ provide: OwnedCvs, useValue: fake }] },
    );
    const { headers } = await signIn(entityManager(app));
    const res = await inject(app, { method: 'GET', url: '/api/probe/cvs/abc', headers });
    await app.close();
    expect(res.json()).toEqual({ id: 'fake-abc' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
