import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ROUTES } from '@cv/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import { Cv } from '../src/db/entities.js';
import {
  launchPrinter,
  longTextPdf,
  manyPagesPdf,
  multipart,
  textPdf,
} from './cvs/pdf-fixtures.js';
import { createTestApp, inject } from './support/create-test-app.js';
import { entityManager, resetDatabase } from './support/db.js';
import { SAMPLE_SOURCE_TEXT } from './support/factories.js';
import { signIn, type TestSession } from './support/session.js';

/** Upload handling of docs/specs/cvs.md beyond the acceptance examples. */

describe('sources: the upload route', () => {
  let app: NestFastifyApplication;
  let printer: Browser;
  let session: TestSession;

  beforeAll(async () => {
    [app, printer] = await Promise.all([createTestApp(), launchPrinter()]);
  });
  afterAll(async () => {
    await Promise.all([app.close(), printer.close()]);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    session = await signIn(entityManager(app));
  });

  const post = (body: ReturnType<typeof multipart>) =>
    inject(app, {
      method: 'POST',
      url: ROUTES.createCvFromPdf.path,
      headers: { ...session.headers, ...body.headers },
      payload: body.payload,
    });

  it('accepts the role after the file part', async () => {
    const bytes = await textPdf(printer, SAMPLE_SOURCE_TEXT);
    const res = await post(
      multipart(
        { targetRole: 'Engineer' },
        { name: 'cv.pdf', type: 'application/pdf', bytes },
        'file-first',
      ),
    );
    expect(res.statusCode).toBe(202);
    expect(await entityManager(app).count(Cv, { targetRole: 'Engineer' })).toBe(1);
  });

  const upload = async (bytes: Buffer) => {
    const res = await post(
      multipart({ targetRole: 'Engineer' }, { name: 'cv.pdf', type: 'application/pdf', bytes }),
    );
    return res;
  };

  it('accepts a PDF of exactly ten pages', async () => {
    const res = await upload(await manyPagesPdf(printer, 10));
    expect(res.statusCode).toBe(202);
  });

  it('refuses a PDF whose text is over the source limit, and creates nothing', async () => {
    const res = await upload(await longTextPdf(printer, 60_000));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(res.json<{ detail: string }>().detail).toContain('50000');
    expect(await entityManager(app).count(Cv)).toBe(0);
  });

  it('answers 400 when there is no file part', async () => {
    const res = await post(multipart({ targetRole: 'Engineer' }));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_FAILED', errors: [{ path: 'file' }] });
  });

  it('does not echo the content of a refused file', async () => {
    const secret = 'SECRET-CV-CONTENT-iryna@example.com';
    const res = await post(
      multipart(
        { targetRole: 'Engineer' },
        {
          name: `${secret}.pdf`,
          type: 'application/pdf',
          bytes: Buffer.from(`%PDF-1.7 ${secret}`),
        },
      ),
    );
    expect(res.statusCode).toBe(422);
    expect(res.body).not.toContain('SECRET-CV-CONTENT');
    expect(res.body).not.toContain('iryna@example.com');
    expect(await entityManager(app).count(Cv)).toBe(0);
  });

  it('refuses an upload without a session', async () => {
    const body = multipart({ targetRole: 'Engineer' });
    const res = await inject(app, {
      method: 'POST',
      url: ROUTES.createCvFromPdf.path,
      headers: { 'sec-fetch-site': 'same-origin', ...body.headers },
      payload: body.payload,
    });
    expect(res.statusCode).toBe(401);
  });
});
