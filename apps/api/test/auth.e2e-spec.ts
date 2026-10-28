import { Writable } from 'node:stream';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ROUTES } from '@cv/shared';
import { pino } from 'pino';
import { EntityManager } from '@mikro-orm/postgresql';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { verify } from 'argon2';
import { hashSessionToken } from '../src/common/session-token.js';
import { ROOT_LOGGER } from '../src/config/tokens.js';
import { Session, User } from '../src/db/entities.js';
import { sidCookie } from './auth/cookies.js';
import { createTestApp, inject } from './support/create-test-app.js';
import { entityManager, resetDatabase } from './support/db.js';
import { createUser, TEST_PASSWORD } from './support/factories.js';

/** Auth behaviour that goes beyond the acceptance examples (docs/specs/auth.md, "Behaviour"). */

// The real argon2, but observable: the login tests count verifications.
vi.mock('argon2', async (original) => {
  const actual = await original<typeof import('argon2')>();
  return { ...actual, verify: vi.fn(actual.verify) };
});

const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin' } as const;
const lines: string[] = [];
const logSink = new Writable({
  write(chunk: Buffer, _encoding, done) {
    lines.push(chunk.toString());
    done();
  },
});

describe('auth', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp(
      {},
      { overrides: [{ provide: ROOT_LOGGER, useValue: pino({ level: 'info' }, logSink) }] },
    );
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    lines.length = 0;
  });

  it('logs the outcome and the user id, never the email, password, token or hashes', async () => {
    const password = 'a very private password';
    const credentials = { email: 'private.person@example.com', password };
    const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
      inject(app, {
        method: 'POST',
        url,
        headers: { ...SAME_ORIGIN, ...headers },
        payload: payload as object,
      });
    const signup = await post(ROUTES.signup.path, credentials);
    const cookie = sidCookie(signup);
    const token = cookie.slice('sid='.length);
    await post(ROUTES.signup.path, credentials);
    await post(ROUTES.login.path, { ...credentials, password: 'a wrong password' });
    await post(ROUTES.logout.path, undefined, { cookie });

    const stored = await entityManager(app).findOneOrFail(User, { email: credentials.email });
    const logged = lines.join('');
    expect(logged).toContain(signup.json<{ id: string }>().id);
    expect(logged).toContain('login failed');
    const secrets = [
      'private.person',
      password,
      'wrong password',
      token,
      hashSessionToken(token),
      stored.passwordHash,
    ];
    for (const secret of secrets) expect(logged).not.toContain(secret);
  });

  it('keeps the other devices signed in when one logs out', async () => {
    const user = await createUser(entityManager(app), { email: 'two@example.com' });
    const login = () =>
      inject(app, {
        method: 'POST',
        url: ROUTES.login.path,
        headers: SAME_ORIGIN,
        payload: { email: user.email, password: TEST_PASSWORD },
      });
    const [phone, laptop] = (await Promise.all([login(), login()])).map(sidCookie);

    await inject(app, {
      method: 'POST',
      url: ROUTES.logout.path,
      headers: { ...SAME_ORIGIN, cookie: phone! },
    });

    const me = (cookie: string) =>
      inject(app, { method: 'GET', url: ROUTES.me.path, headers: { cookie } });
    expect((await me(phone!)).statusCode).toBe(401);
    expect((await me(laptop!)).statusCode).toBe(200);
    expect(await entityManager(app).count(Session)).toBe(1);
  });

  it('stores only the hash of the session token', async () => {
    const signup = await inject(app, {
      method: 'POST',
      url: ROUTES.signup.path,
      headers: SAME_ORIGIN,
      payload: { email: 'iryna@example.com', password: 'correct horse' },
    });
    const token = sidCookie(signup).slice('sid='.length);
    const sessions = await entityManager(app).find(Session, {});
    expect(sessions.map((session) => session.tokenHash)).toEqual([hashSessionToken(token)]);
  });

  it('describes the four routes in Swagger with their schemas', async () => {
    const res = await inject(app, { method: 'GET', url: '/api/docs-json' });
    expect(res.statusCode).toBe(200);
    interface Operation {
      requestBody?: unknown;
      responses?: Record<string, unknown>;
    }
    const { paths } = res.json<{ paths: Record<string, Record<string, Operation>> }>();
    const operation = (route: { path: string; method: string }) =>
      paths[route.path]?.[route.method.toLowerCase()];

    for (const route of [ROUTES.signup, ROUTES.login, ROUTES.logout, ROUTES.me]) {
      expect(operation(route)).toBeDefined();
    }
    expect(JSON.stringify(operation(ROUTES.signup)?.requestBody)).toContain('password');
    expect(JSON.stringify(operation(ROUTES.login)?.requestBody)).toContain('password');
    expect(operation(ROUTES.me)?.responses).toHaveProperty('200');
  });

  describe('the unique index is the final check on sign-up', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('answers EMAIL_TAKEN when the pre-check misses a user that appears in between', async () => {
      await createUser(entityManager(app), { email: 'race@example.com' });
      // The pre-check sees no user, as it would in a parallel sign-up that commits a moment later.
      vi.spyOn(EntityManager.prototype, 'count').mockResolvedValueOnce(0);

      const res = await inject(app, {
        method: 'POST',
        url: ROUTES.signup.path,
        headers: SAME_ORIGIN,
        payload: { email: 'race@example.com', password: 'correct horse' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ code: 'EMAIL_TAKEN' });
      expect(await entityManager(app).count(User)).toBe(1);
    });
  });

  it('verifies a password hash for an unknown email too, so both failures cost the same', async () => {
    const user = await createUser(entityManager(app), { email: 'known@example.com' });
    const attempt = (email: string, password: string) =>
      inject(app, {
        method: 'POST',
        url: ROUTES.login.path,
        headers: SAME_ORIGIN,
        payload: { email, password },
      });
    vi.mocked(verify).mockClear();

    await attempt(user.email, 'not the password');
    expect(verify).toHaveBeenCalledTimes(1);
    await attempt('nobody@example.com', TEST_PASSWORD);
    expect(verify).toHaveBeenCalledTimes(2);
  });
});

describe('auth: rate limit on signup only', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp({ AUTH_RATE_LIMIT_PER_MINUTE: 3 });
  });
  afterAll(async () => {
    await app.close();
  });

  it('throttles signup per client address but not me or logout', async () => {
    await resetDatabase(app);
    const signup = (n: number) =>
      inject(app, {
        method: 'POST',
        url: ROUTES.signup.path,
        remoteAddress: '10.0.0.5',
        headers: { ...SAME_ORIGIN, 'x-forwarded-for': '203.0.113.9' },
        payload: { email: `user${n}@example.com`, password: 'correct horse' },
      });
    const first = await signup(1);
    const statuses = [first.statusCode];
    for (const n of [2, 3, 4]) statuses.push((await signup(n)).statusCode);
    expect(statuses).toEqual([201, 201, 201, 429]);

    // The same address keeps using the signed-in routes: they are not throttled.
    const headers = { ...SAME_ORIGIN, cookie: sidCookie(first), 'x-forwarded-for': '203.0.113.9' };
    for (let i = 0; i < 5; i++) {
      const me = await inject(app, {
        method: 'GET',
        url: ROUTES.me.path,
        remoteAddress: '10.0.0.5',
        headers,
      });
      expect(me.statusCode).toBe(200);
    }
  });
});
