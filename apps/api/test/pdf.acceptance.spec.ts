import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FONT_FILES } from '@cv/cv-template';
import { problemSchema, ROUTES, routePath } from '@cv/shared';
import { extractText, getDocumentProxy } from 'unpdf';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EMBEDDED_FONTS } from '../src/pdf/embedded-fonts.js';
import { createTestApp, inject } from './support/create-test-app.js';
import { entityManager, resetDatabase } from './support/db.js';
import { createCv, sampleDocument } from './support/factories.js';
import { signIn, type TestSession } from './support/session.js';

/** Acceptance examples PDF-1 to PDF-4 of docs/specs/pdf.md, with real Chromium. PDF-5 is the ownership test. */

describe('pdf acceptance (docs/specs/pdf.md)', () => {
  let app: NestFastifyApplication;
  let session: TestSession;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    session = await signIn(entityManager(app));
  });

  const download = (id: string, application: NestFastifyApplication = app) =>
    inject(application, {
      method: 'GET',
      url: routePath(ROUTES.downloadPdf.path, { id }),
      headers: session.headers,
    });

  it('PDF-1 — a real A4 PDF with selectable text and the embedded font', async () => {
    const cv = await createCv(entityManager(app), {
      user: session.user,
      document: sampleDocument(),
    });

    const res = await download(cv.id);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    const bytes = res.rawPayload;
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');

    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = (await pdf.getPage(1)).view;
    // A4 is 595.3 x 841.9 pt; Chromium rounds the paper size a little differently.
    expect(Math.abs(x1 - x0 - 595.3)).toBeLessThanOrEqual(1);
    expect(Math.abs(y1 - y0 - 841.9)).toBeLessThanOrEqual(1);
    const { text } = await extractText(pdf, { mergePages: true });
    const flat = text.replace(/\s+/g, ' ');
    expect(flat).toContain('Iryna Kovalenko');
    expect(flat).toContain('Acme Corp');
    expect(flat).toContain('Migrated billing to TypeScript.');
    expect(bytes.toString('latin1')).toContain('IBMPlexSans');
  });

  it('PDF-2 — no document yet', async () => {
    const cv = await createCv(entityManager(app), { user: session.user });
    const res = await download(cv.id);
    expect(res.statusCode).toBe(409);
    expect(problemSchema.parse(res.json()).code).toBe('DOCUMENT_NOT_READY');
  });

  it('PDF-3 — no fallback font', async () => {
    const broken = await createTestApp(
      {},
      {
        overrides: [
          {
            provide: EMBEDDED_FONTS,
            // Valid base64, but not a font: the faces fail to load and Chromium would fall back to a system font.
            useValue: Object.fromEntries(
              FONT_FILES.map((file) => [
                file,
                Buffer.from('this is not a font').toString('base64'),
              ]),
            ),
          },
        ],
      },
    );
    try {
      const cv = await createCv(entityManager(broken), {
        user: session.user,
        document: sampleDocument(),
      });
      const res = await download(cv.id, broken);
      expect(res.statusCode).toBe(503);
      expect(problemSchema.parse(res.json()).code).toBe('PDF_RENDER_FAILED');
    } finally {
      await broken.close();
    }
  });

  it('PDF-4 — the file name carries the person', async () => {
    const document = sampleDocument();
    const cv = await createCv(entityManager(app), {
      user: session.user,
      document: { ...document, contacts: { ...document.contacts, fullName: 'Олег Савчук' } },
    });

    const res = await download(cv.id);
    expect(res.statusCode).toBe(200);
    const disposition = String(res.headers['content-disposition']);
    expect(disposition).toContain(
      "filename*=UTF-8''%D0%9E%D0%BB%D0%B5%D0%B3%20%D0%A1%D0%B0%D0%B2%D1%87%D1%83%D0%BA%20CV.pdf",
    );
    const ascii = /filename="([^"]*)"/.exec(disposition)?.[1];
    expect(ascii).toMatch(/^[\x20-\x7e]+\.pdf$/);
  });
});
