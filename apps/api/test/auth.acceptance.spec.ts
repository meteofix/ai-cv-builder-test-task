import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { problemSchema, ROUTES, userSchema } from '@cv/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Session, User } from '../src/db/entities.js';
import { setCookieOf, sidCookie } from './auth/cookies.js';
import { createTestApp, inject } from './support/create-test-app.js';
import { entityManager, resetDatabase } from './support/db.js';
import { createUser, TEST_PASSWORD } from './support/factories.js';

/** Acceptance examples of docs/specs/auth.md. */

const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin' } as const;

describe('auth acceptance (docs/specs/auth.md)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
  });

  function post(url: string, payload?: unknown, headers: Record<string, string> = {}) {
    return inject(app, {
      method: 'POST',
      url,
      headers: { ...SAME_ORIGIN, ...headers },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  }
  const signup = (email: string, password: string) => post(ROUTES.signup.path, { email, password });
  const login = (email: string, password: string, headers: Record<string, string> = {}) =>
    post(ROUTES.login.path, { email, password }, headers);
  const me = (cookie: string) =>
    inject(app, { method: 'GET', url: ROUTES.me.path, headers: { ...SAME_ORIGIN, cookie } });

  it('AUTH-1 — sign-up signs the user in', async () => {
    const res = await signup('Iryna@Example.com', 'correct horse');
    expect(res.statusCode).toBe(201);
    const body = userSchema.parse(res.json());
    expect(body.email).toBe('iryna@example.com');

    const cookie = setCookieOf(res);
    expect(cookie).toMatch(/^sid=[\w-]+;/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=2592000');
    expect(cookie).not.toMatch(/Secure/i);

    const current = await me(sidCookie(res));
    expect(current.statusCode).toBe(200);
    expect(current.json()).toEqual(res.json());
  });

  it('AUTH-2 — one account per email, any case', async () => {
    expect((await signup('Iryna@Example.com', 'correct horse')).statusCode).toBe(201);
    const again = await signup(' iryna@example.com ', 'another pass');
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'EMAIL_TAKEN' });
    expect(again.headers['set-cookie']).toBeUndefined();
  });

  it('AUTH-3 — the two login failures look the same', async () => {
    const user = await createUser(entityManager(app), { email: 'known@example.com' });
    const wrongPassword = await login(user.email, 'not the password');
    const unknownEmail = await login('nobody@example.com', TEST_PASSWORD);

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    const bodies = [wrongPassword, unknownEmail].map((res) => ({
      ...problemSchema.parse(res.json()),
      requestId: undefined,
    }));
    expect(bodies[0]).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(bodies[0]).toEqual(bodies[1]);
    expect(wrongPassword.headers['set-cookie']).toBeUndefined();
    expect(unknownEmail.headers['set-cookie']).toBeUndefined();
  });

  it('AUTH-4 — login from a second device', async () => {
    const first = await signup('iryna@example.com', 'correct horse');
    const second = await login('iryna@example.com', 'correct horse');
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());

    expect(sidCookie(second)).not.toBe(sidCookie(first));
    expect((await me(sidCookie(first))).statusCode).toBe(200);
    expect((await me(sidCookie(second))).statusCode).toBe(200);
  });

  it('AUTH-5 — logout revokes the session on the server', async () => {
    const cookie = sidCookie(await signup('iryna@example.com', 'correct horse'));
    const res = await post(ROUTES.logout.path, undefined, { cookie });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    // The cookie is expired by the same name and path it was set with.
    const cleared = setCookieOf(res);
    expect(cleared).toMatch(/^sid=;/);
    expect(cleared).toContain('Path=/');
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/);

    const after = await me(cookie);
    expect(after.statusCode).toBe(401);
    expect(after.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('AUTH-6 — the password is stored as argon2id', async () => {
    await signup('iryna@example.com', 'correct horse');
    const user = await entityManager(app).findOneOrFail(User, { email: 'iryna@example.com' });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain('correct horse');
  });

  it.each([
    ['a short password', { email: 'iryna@example.com', password: 'short' }, 'password'],
    ['a malformed email', { email: 'not-an-email', password: 'correct horse' }, 'email'],
  ])('AUTH-7 — invalid input: %s', async (_case, body, path) => {
    const res = await signup(body.email, body.password);
    expect(res.statusCode).toBe(400);
    const problem = problemSchema.parse(res.json());
    expect(problem.code).toBe('VALIDATION_FAILED');
    expect(problem.errors?.map((error) => error.path)).toContain(path);
    expect(await entityManager(app).count(User)).toBe(0);
  });

  it('AUTH-9 — Secure cookie behind TLS', async () => {
    const secureApp = await createTestApp({ COOKIE_SECURE: true });
    try {
      const res = await inject(secureApp, {
        method: 'POST',
        url: ROUTES.signup.path,
        headers: SAME_ORIGIN,
        payload: { email: 'iryna@example.com', password: 'correct horse' },
      });
      expect(res.statusCode).toBe(201);
      expect(setCookieOf(res)).toMatch(/;\s*Secure/i);
    } finally {
      await secureApp.close();
    }
  });
});

describe('auth acceptance: rate limit (docs/specs/auth.md)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp({ AUTH_RATE_LIMIT_PER_MINUTE: 3 });
  });
  afterAll(async () => {
    await app.close();
  });

  it('AUTH-8 — login rate limit per client address', async () => {
    await resetDatabase(app);
    const user = await createUser(entityManager(app));
    // A private remoteAddress is a trusted proxy, so the client address is the one in X-Forwarded-For.
    const attempt = (address: string) =>
      inject(app, {
        method: 'POST',
        url: ROUTES.login.path,
        remoteAddress: '10.0.0.5',
        headers: { ...SAME_ORIGIN, 'x-forwarded-for': address },
        payload: { email: user.email, password: 'wrong password' },
      });

    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await attempt('203.0.113.9')).statusCode);
    expect(statuses).toEqual([401, 401, 401, 429]);

    const limited = await attempt('203.0.113.9');
    expect(limited.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect((await attempt('203.0.113.10')).statusCode).not.toBe(429);
  });
});

describe('auth: required tests beyond the examples', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
  });

  it('answers 401 on me for an expired session', async () => {
    const signedUp = await inject(app, {
      method: 'POST',
      url: ROUTES.signup.path,
      headers: SAME_ORIGIN,
      payload: { email: 'iryna@example.com', password: 'correct horse' },
    });
    const cookie = sidCookie(signedUp);
    const em = entityManager(app);
    await em.nativeUpdate(Session, {}, { expiresAt: new Date(Date.now() - 1000) });

    const res = await inject(app, {
      method: 'GET',
      url: ROUTES.me.path,
      headers: { ...SAME_ORIGIN, cookie },
    });
    expect(res.statusCode).toBe(401);
  });

  it('ends a parallel double sign-up with one user: one 201, one 409', async () => {
    const attempts = await Promise.all(
      [1, 2].map(() =>
        inject(app, {
          method: 'POST',
          url: ROUTES.signup.path,
          headers: SAME_ORIGIN,
          payload: { email: 'race@example.com', password: 'correct horse' },
        }),
      ),
    );
    expect(attempts.map((res) => res.statusCode).sort()).toEqual([201, 409]);
    expect(await entityManager(app).count(User)).toBe(1);
  });

  it('rejects a cross-site signup with 403 before the handler runs', async () => {
    const res = await inject(app, {
      method: 'POST',
      url: ROUTES.signup.path,
      headers: { 'sec-fetch-site': 'cross-site' },
      payload: { email: 'iryna@example.com', password: 'correct horse' },
    });
    expect(res.statusCode).toBe(403);
    expect(await entityManager(app).count(User)).toBe(0);
  });

  it('requires a session for logout and me', async () => {
    const logout = await inject(app, {
      method: 'POST',
      url: ROUTES.logout.path,
      headers: SAME_ORIGIN,
    });
    const current = await inject(app, { method: 'GET', url: ROUTES.me.path });
    expect([logout.statusCode, current.statusCode]).toEqual([401, 401]);
  });
});
