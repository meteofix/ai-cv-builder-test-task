import { readFile } from 'node:fs/promises';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createCvResponseSchema, problemSchema, ROUTES } from '@cv/shared';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Cv, CvSource } from '../src/db/entities.js';
import {
  imageOnlyPdf,
  launchPrinter,
  manyPagesPdf,
  multipart,
  textPdf,
  type UploadFile,
} from './cvs/pdf-fixtures.js';
import { createTestApp, inject } from './support/create-test-app.js';
import { entityManager, resetDatabase } from './support/db.js';
import { SAMPLE_SOURCE_TEXT } from './support/factories.js';
import { signIn, type TestSession } from './support/session.js';

/** Acceptance examples CVS-2, CVS-3 and CVS-4 of docs/specs/cvs.md: creating a CV from a PDF. */

const ROLE = 'Senior Backend Engineer';
const PDF_TYPE = 'application/pdf';

describe('sources acceptance (docs/specs/cvs.md)', () => {
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

  function upload(
    file: UploadFile | undefined,
    fields: Record<string, string> = { targetRole: ROLE },
  ) {
    const { payload, headers } = multipart(fields, file);
    return inject(app, {
      method: 'POST',
      url: ROUTES.createCvFromPdf.path,
      headers: { ...session.headers, ...headers },
      payload,
    });
  }
  const pdfFile = (bytes: Buffer, name = 'cv.pdf'): UploadFile => ({ name, type: PDF_TYPE, bytes });
  const cvCount = () => entityManager(app).count(Cv);

  it('CVS-2 — create from a PDF keeps only the text', async () => {
    const res = await upload(pdfFile(await textPdf(printer, SAMPLE_SOURCE_TEXT)));
    expect(res.statusCode).toBe(202);
    const { cvId, job } = createCvResponseSchema.parse(res.json());
    expect(job).toMatchObject({ kind: 'generate', status: 'queued' });

    const source = await entityManager(app).findOneOrFail(CvSource, { cv: cvId });
    expect(source.kind).toBe('pdf');
    expect(source.text).toContain('Iryna Kovalenko');
    expect(source.text).toContain('Acme Corp');
    expect(await entityManager(app).findOneOrFail(Cv, cvId)).toMatchObject({ targetRole: ROLE });
  });

  describe('CVS-3 — bad files are refused with a clear code and create nothing', () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==',
      'base64',
    );
    const tenMiBPlusOne = Buffer.concat([
      Buffer.from('%PDF-'),
      Buffer.alloc(10 * 1024 * 1024 + 1 - 5, 0x20),
    ]);

    const cases: [string, () => Promise<Buffer>, number, string][] = [
      ['an empty file', () => Promise.resolve(Buffer.alloc(0)), 422, 'PDF_INVALID'],
      ['PNG bytes sent as cv.pdf', () => Promise.resolve(png), 422, 'PDF_INVALID'],
      [
        '%PDF-1.7 followed by garbage',
        () => Promise.resolve(Buffer.from('%PDF-1.7\nthis is not a pdf at all\n')),
        422,
        'PDF_INVALID',
      ],
      [
        'a PDF that is only a picture of text',
        () => imageOnlyPdf(printer, SAMPLE_SOURCE_TEXT),
        422,
        'PDF_NO_TEXT',
      ],
      [
        'the encrypted fixture',
        () => readFile(new URL('./cvs/fixtures/encrypted.pdf', import.meta.url)),
        422,
        'PDF_ENCRYPTED',
      ],
      ['a PDF with 11 pages', () => manyPagesPdf(printer, 11), 422, 'PDF_TOO_MANY_PAGES'],
      [
        '10 MiB + 1 byte starting with %PDF-',
        () => Promise.resolve(tenMiBPlusOne),
        413,
        'PDF_TOO_LARGE',
      ],
    ];

    it.each(cases)('%s', async (_name, make, status, code) => {
      const res = await upload(pdfFile(await make()));
      expect(res.statusCode).toBe(status);
      expect(problemSchema.parse(res.json()).code).toBe(code);
      expect(await cvCount()).toBe(0);
    });
  });

  it('CVS-4 — the role is required for uploads too', async () => {
    const res = await upload(pdfFile(await textPdf(printer, SAMPLE_SOURCE_TEXT)), {});
    expect(res.statusCode).toBe(400);
    expect(problemSchema.parse(res.json()).code).toBe('VALIDATION_FAILED');
    expect(await cvCount()).toBe(0);
  });
});
