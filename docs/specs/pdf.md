# PDF — download a CV as an A4 PDF

**Area:** `apps/api/src/pdf/`, tests `apps/api/test/pdf.*`. **Builds on (frozen at S0):** `renderCvHtml(document, { fonts })` and `PDF_OPTIONS` from `@cv/cv-template`, `loadEmbeddedFonts()` from `@cv/cv-template/node`; `findOwned`; `ROUTES.downloadPdf`. Decisions: [019](../DECISIONS.md#019-one-html-template-for-preview-and-pdf), [020](../DECISIONS.md#020-embedded-fonts-loaded-before-printing).

## Goal

The user downloads the current CV as an A4 PDF with selectable text that looks like the preview: the same HTML from the same template, printed by Chromium with the embedded IBM Plex Sans. A missing font is a clear failure, never a PDF in a fallback font.

## Contracts

`GET /api/cvs/:id/pdf` → 200 `application/pdf`; 404 `CV_NOT_FOUND`; 409 `DOCUMENT_NOT_READY` (no document yet); 503 `PDF_RENDER_FAILED`.

Headers on success: `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="<ascii>.pdf"; filename*=UTF-8''<percent-encoded>.pdf` where the name is `<fullName> CV` (or `CV` when the name is empty), `Cache-Control: no-store`. Control and invisible format characters (such as a right-to-left override), quotes, backslashes, slashes, semicolons and `%` are replaced by a space in the name; the ASCII `filename` drops every non-ASCII character (`CV.pdf` when nothing is left); the UTF-8 form escapes `' ( ) *` as RFC 5987 requires.

## Behaviour

1. `findOwned`; no document → 409 `DOCUMENT_NOT_READY`. A CV with an active job can still be downloaded: the stored document is complete.
2. HTML: `renderCvHtml(document, { fonts: { embedded } })`, with the fonts loaded once per process by `loadEmbeddedFonts()` and provided under the token `EMBEDDED_FONTS` (`src/pdf/embedded-fonts.ts`), which tests replace. The service inserts a CSP `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:">` right after `<head>`, so the page cannot run its own scripts or fetch anything; our `page.evaluate` still runs.
3. Browser: one Chromium per API process, launched on first use with `--disable-dev-shm-usage` and Chromium's sandbox off (the container runs as a non-root user; the README says so). A crashed or disconnected browser is relaunched on the next request. `onModuleDestroy` closes it (graceful shutdown).
4. Each render: a new context with `offline: true` → `page.setContent(html, { waitUntil: 'load' })` → in `page.evaluate`: load every declared `FontFace` explicitly (`Promise.allSettled([...document.fonts].map((face) => face.load()))`, because a face with a `unicode-range` the page does not use is never loaded on its own), await `document.fonts.ready`, and require that the `IBM Plex Sans` faces number six (three weights × Latin and Cyrillic) and all have `status === 'loaded'` (do not rely on `document.fonts.check()`: it returns true when no face of the family is declared at all) → `page.pdf(PDF_OPTIONS)` → close the context. A failed font check, a Chromium error or the 15 s timeout → 503 `PDF_RENDER_FAILED`, with the cause logged (no CV content). On the timeout the render's context is closed, so Chromium stops working on it, and a request still waiting for a slot never starts one.
5. At most 2 renders run at once; further requests wait their turn (no 429). The 15 s timeout covers waiting plus rendering.
6. Synchronous on the request: no job, no stored PDF.

## Acceptance examples

Test file `apps/api/test/pdf.acceptance.spec.ts`, real Chromium. The CV comes from the factories with `sampleDocument()`.

- **PDF-1 — a real A4 PDF with selectable text and the embedded font.** `GET /api/cvs/:id/pdf` as the owner → 200, `content-type: application/pdf`, the body starts with `%PDF-`; with `unpdf`: the first page is 595.3 × 841.9 pt (± 1); the extracted text contains `Iryna Kovalenko`, `Acme Corp` and `Led the migration of billing to TypeScript.`; the font names in the file include `IBMPlexSans`.
- **PDF-2 — no document yet.** A CV without a document → 409 `DOCUMENT_NOT_READY`.
- **PDF-3 — no fallback font.** With the embedded font source replaced by a broken one (provider override in `createTestApp`, for example fonts whose data is not a font) → 503 `PDF_RENDER_FAILED`.
- **PDF-4 — the file name carries the person.** For `fullName` "Олег Савчук" the `Content-Disposition` has `filename*=UTF-8''%D0%9E%D0%BB%D0%B5%D0%B3%20%D0%A1%D0%B0%D0%B2%D1%87%D1%83%D0%BA%20CV.pdf` and an ASCII `filename` without non-ASCII characters.
- **PDF-5 — ownership.** From a second account → 404 `CV_NOT_FOUND` (main's ownership test).

ATS readability of the PDF (whole-word section titles, section order, dates next to positions) is tested in the template package, see [cv-template.md](cv-template.md).

## Definition of done

The acceptance examples pass with real Chromium; `docker compose up` produces a PDF from the running app; the API image still runs as a non-root user; this spec matches the code.

## Required tests

The acceptance examples, plus: three parallel requests all succeed (the third waits); the browser is relaunched after it was closed under the service.
