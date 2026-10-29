import { Writable } from 'node:stream';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { problemSchema } from '@cv/shared';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/bootstrap.js';
import { inject } from './support/create-test-app.js';
import { ProbeModule } from './support/probe.module.js';
import { testConfig } from './support/test-config.js';

const lines: string[] = [];
const logSink = new Writable({
  write(chunk: Buffer, _encoding, done) {
    lines.push(chunk.toString());
    done();
  },
});
const logged = () =>
  lines
    .join('')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

/**
 * Every other e2e test builds the app through @nestjs/testing; this one goes through createApp exactly as
 * main.ts does, because CI builds the Docker images but never starts them. The test config has a fake API
 * key and the worker off, so no request can reach Anthropic.
 */
describe('createApp (the production entry point)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApp(testConfig(), pino({ level: 'info' }, logSink), {
      imports: [ProbeModule],
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    lines.length = 0;
  });

  it.each([['/api/health/live'], ['/api/health/ready']])('answers %s with 200', async (url) => {
    expect((await inject(app, { method: 'GET', url })).statusCode).toBe(200);
  });

  // nginx sends X-Request-Id: the request and response lines carry it, and the response echoes it.
  it('logs and echoes a valid X-Request-Id header', async () => {
    const id = 'r'.repeat(128);
    const res = await inject(app, {
      method: 'GET',
      url: '/api/health/live',
      headers: { 'x-request-id': id },
    });
    expect(res.headers['x-request-id']).toBe(id);
    const request = logged().filter((line) => 'req' in line);
    const response = logged().filter((line) => 'res' in line);
    expect(request.map((line) => line.reqId)).toEqual([id]);
    expect(response.map((line) => line.reqId)).toEqual([id]);
  });

  it.each([
    ['no header', undefined],
    ['an empty header', ''],
    ['an id over 128 characters', 'r'.repeat(129)],
    ['characters outside [A-Za-z0-9_.-]', 'bad id {}'],
  ])('gives a request with %s a fresh id', async (_case, sent) => {
    const res = await inject(app, {
      method: 'GET',
      url: '/api/health/live',
      headers: sent === undefined ? {} : { 'x-request-id': sent },
    });
    const id = z.uuid().parse(res.headers['x-request-id']);
    expect(
      logged()
        .filter((line) => 'req' in line)
        .map((line) => line.reqId),
    ).toEqual([id]);
  });

  // The web app shows the request id of a 5xx as "Error ID"; it must find the logged error.
  it('logs a 5xx under the request id the problem carries', async () => {
    const res = await inject(app, {
      method: 'GET',
      url: '/api/probe/crash',
      headers: { 'x-request-id': 'req-crash-1' },
    });
    expect(res.statusCode).toBe(500);
    expect(problemSchema.parse(res.json()).requestId).toBe('req-crash-1');
    const failure = logged().find((line) => line.msg === 'Request failed');
    expect(failure?.reqId).toBe('req-crash-1');
  });
});
