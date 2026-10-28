import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { problemSchema } from '@cv/shared';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, inject } from './support/create-test-app.js';
import { ProbeModule } from './support/probe.module.js';

describe('error responses (RFC 9457)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp({}, { imports: [ProbeModule] });
  });
  afterAll(async () => {
    await app.close();
  });

  const json = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' };

  it.each<[string, InjectOptions, number, string]>([
    ['an expected error', { method: 'GET', url: '/api/probe/conflict' }, 409, 'VERSION_CONFLICT'],
    ['a missing session', { method: 'GET', url: '/api/probe/me' }, 401, 'UNAUTHENTICATED'],
    ['an unknown route', { method: 'GET', url: '/api/nothing-here' }, 404, 'NOT_FOUND'],
    [
      'a cross-site POST (CSRF)',
      { method: 'POST', url: '/api/probe/me', headers: { 'sec-fetch-site': 'cross-site' } },
      403,
      'FORBIDDEN',
    ],
    [
      'a body that is not JSON',
      { method: 'POST', url: '/api/probe/validate', headers: json, payload: '{"email":' },
      400,
      'VALIDATION_FAILED',
    ],
    [
      'a body over the size limit',
      {
        method: 'POST',
        url: '/api/probe/validate',
        headers: json,
        payload: JSON.stringify({ email: 'x'.repeat(2 * 1024 * 1024) }),
      },
      413,
      'PAYLOAD_TOO_LARGE',
    ],
    ['an unexpected error', { method: 'GET', url: '/api/probe/crash' }, 500, 'INTERNAL'],
  ])('answers %s with problem+json', async (_case, request, status, code) => {
    const res = await inject(app, {
      ...request,
      headers: { ...request.headers, 'x-request-id': 'req-1' },
    });
    expect(res.statusCode).toBe(status);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    const body = problemSchema.parse(res.json());
    expect(body).toMatchObject({ status, code, requestId: 'req-1' });
  });

  it('lists the failing fields of an invalid body', async () => {
    const res = await inject(app, {
      method: 'POST',
      url: '/api/probe/validate',
      headers: json,
      payload: { email: 'not-an-email', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
    const body = problemSchema.parse(res.json());
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.errors?.map((error) => error.path).sort()).toEqual(['email', 'password']);
  });

  it('keeps the detail of an expected error', async () => {
    const res = await inject(app, { method: 'GET', url: '/api/probe/conflict' });
    expect(res.json()).toMatchObject({ detail: 'The CV was changed elsewhere.' });
  });

  it('never sends the message of an unexpected error to the client', async () => {
    const res = await inject(app, { method: 'GET', url: '/api/probe/crash' });
    expect(res.body).not.toMatch(/10\.0\.0\.7|iryna|connection/);
    expect(res.json()).not.toHaveProperty('detail');
  });
});
