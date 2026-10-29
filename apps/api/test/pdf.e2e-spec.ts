import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ROUTES, routePath } from '@cv/shared';
import { extractText, getDocumentProxy } from 'unpdf';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfRenderer } from '../src/pdf/pdf-renderer.service.js';
import { createTestApp, inject } from './support/create-test-app.js';
import { entityManager, resetDatabase } from './support/db.js';
import { createCv, createJob, sampleDocument } from './support/factories.js';
import { signIn, type TestSession } from './support/session.js';

/** Behaviour of docs/specs/pdf.md beyond the acceptance examples (real Chromium). */

describe('pdf', () => {
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

  const download = (id: string) =>
    inject(app, {
      method: 'GET',
      url: routePath(ROUTES.downloadPdf.path, { id }),
      headers: session.headers,
    });
  const newCv = (document = sampleDocument()) =>
    createCv(entityManager(app), { user: session.user, document });

  it('sets the download headers', async () => {
    const res = await download((await newCv()).id);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(String(res.headers['content-disposition'])).toMatch(
      /^attachment; filename="Iryna Kovalenko CV\.pdf"/,
    );
  });

  it('serves three parallel requests, the third waiting for a free slot', async () => {
    const cvs = await Promise.all([newCv(), newCv(), newCv()]);
    const responses = await Promise.all(cvs.map((cv) => download(cv.id)));
    expect(responses.map((res) => res.statusCode)).toEqual([200, 200, 200]);
    for (const res of responses) expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('launches a new browser after the old one was closed under the service', async () => {
    const cv = await newCv();
    expect((await download(cv.id)).statusCode).toBe(200);

    // The browser handle is private on purpose; the test reaches in to close it the way a crash would.
    const renderer = app.get(PdfRenderer);
    const browser = await (
      renderer as unknown as { browser: Promise<{ close: () => Promise<void> }> }
    ).browser;
    await browser.close();

    expect((await download(cv.id)).statusCode).toBe(200);
  });

  it('downloads the stored document while a job is active', async () => {
    const cv = await newCv();
    await createJob(entityManager(app), { cv, kind: 'apply_answer', status: 'running' });
    expect((await download(cv.id)).statusCode).toBe(200);
  });

  it('keeps `$&` and markup of the CV text as text, and wraps the page in a locked-down policy', async () => {
    const html: string[] = [];
    const render = vi.spyOn(PdfRenderer.prototype, 'render').mockImplementation((page) => {
      html.push(page);
      return Promise.resolve(Buffer.from('%PDF-fake'));
    });
    try {
      const document = sampleDocument();
      const cv = await newCv({ ...document, headline: "R&D $& <b>Lead</b> $'" });
      expect((await download(cv.id)).statusCode).toBe(200);
    } finally {
      render.mockRestore();
    }
    const [page = ''] = html;
    expect(page).toMatch(
      /^<!DOCTYPE html><html lang="en"><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:">/,
    );
    expect(page).toContain('R&amp;D $&amp; &lt;b&gt;Lead&lt;/b&gt;');
  });

  it('prints Cyrillic text with the embedded font', async () => {
    const document = sampleDocument();
    const cv = await newCv({
      ...document,
      locale: 'uk',
      contacts: { ...document.contacts, fullName: 'Олег Савчук' },
    });
    const res = await download(cv.id);
    expect(res.statusCode).toBe(200);
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(res.rawPayload)), {
      mergePages: true,
    });
    expect(text).toContain('Олег Савчук');
  });

  it('starts a page inside a job with the company and "continued" (docs/specs/cv-template.md §10)', async () => {
    const document = sampleDocument();
    const [job] = document.experience;
    // One job long enough to run over the first page.
    const items = Array.from({ length: 20 }, (_, i) => ({
      id: `b${i}`,
      text: `Delivered the reporting change number ${i + 1} for the finance team, with tests, a migration plan and a rollback runbook that operations signed off`,
      factIds: [],
    }));
    const cv = await newCv({
      ...document,
      experience: [{ ...job!, groups: [{ id: 'g1', title: null, items }] }],
    });
    const res = await download(cv.id);
    expect(res.statusCode).toBe(200);
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(res.rawPayload)), {
      mergePages: false,
    });
    expect(text.length).toBeGreaterThan(1);
    expect(text[1]).toMatch(/^Acme Corp — continued/);
  });
});
