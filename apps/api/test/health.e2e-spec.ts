import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './support/create-test-app.js';

describe('application wiring', () => {
  let app: NestFastifyApplication;
  const inject = (options: InjectOptions) => app.getHttpAdapter().getInstance().inject(options);

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('answers /api/health/live and /api/health/ready', async () => {
    expect((await inject({ method: 'GET', url: '/api/health/live' })).statusCode).toBe(200);
    expect((await inject({ method: 'GET', url: '/api/health/ready' })).statusCode).toBe(200);
  });

  it('sets security headers and echoes the request id from the proxy', async () => {
    const res = await inject({
      method: 'GET',
      url: '/api/health/live',
      headers: { 'x-request-id': 'req-from-nginx' },
    });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-request-id']).toBe('req-from-nginx');
    // The test config is plain HTTP (COOKIE_SECURE=false), where upgrading requests to https would break a LAN setup.
    expect(res.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
  });

  it('rejects a cross-site POST with 403 (CSRF protection)', async () => {
    const res = await inject({
      method: 'POST',
      url: '/api/anything',
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('serves the Swagger UI at /api/docs', async () => {
    expect((await inject({ method: 'GET', url: '/api/docs' })).statusCode).toBe(200);
  });
});
