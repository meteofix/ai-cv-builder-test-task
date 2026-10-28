import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { inject } from './support/create-test-app.js';
import { testConfig } from './support/test-config.js';

/**
 * Every other e2e test builds the app through @nestjs/testing; this one goes through createApp exactly as
 * main.ts does, because CI builds the Docker images but never starts them. The test config has a fake API
 * key and the worker off, so no request can reach Anthropic.
 */
describe('createApp (the production entry point)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApp(testConfig(), pino({ level: 'silent' }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it.each([['/api/health/live'], ['/api/health/ready']])('answers %s with 200', async (url) => {
    expect((await inject(app, { method: 'GET', url })).statusCode).toBe(200);
  });
});
