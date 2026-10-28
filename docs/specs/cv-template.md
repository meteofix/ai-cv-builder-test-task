# CV template — one HTML for the preview and the PDF

**Area:** `packages/cv-template/src/**` and `packages/cv-template/test/**`, except the main-only files `src/index.ts`, `src/pdf-options.ts`, `src/node.ts` and `src/fonts.ts`. **Frozen at S0:** the signatures of `renderCvHtml(document, { fonts })`, `renderCvBody(document)`, `renderCvShell({ fonts }, lang?, title?)`, `PDF_OPTIONS`, `FontSource` and `loadEmbeddedFonts()`. **Reference:** `docs/design/cv-template/resume-a-en.html` and `resume-b-uk.html`. Decisions: [015](../DECISIONS.md#015-the-cv-keeps-the-source-language), [019](../DECISIONS.md#019-one-html-template-for-preview-and-pdf), [020](../DECISIONS.md#020-embedded-fonts-loaded-before-printing).

## Goal

The CV looks like the reference on screen and in the PDF, in English and Ukrainian, and stays readable for applicant tracking systems: section titles extract as whole words, sections keep their order, dates stay next to their positions.

## Contracts

- `renderCvBody(document)` — the inner HTML of `<body>`: what the live preview writes into its iframe on every edit.
- `renderCvShell({ fonts }, lang = 'en', title = '')` — a complete page without content (`<html lang>`, `<title>`, `@font-face` rules and the template CSS); the preview sets it once.
- `renderCvHtml(document, { fonts })` — `renderCvShell` with `lang = document.locale` and `title` = `"<fullName> — <headline>"` (empty parts and the dash left out), with the body inserted: what the PDF endpoint prints.
- `PDF_OPTIONS = { format: 'A4', printBackground: true, tagged: true }` — used by the PDF endpoint and by the ATS test here. The page margin (17 mm) and size come from the template's `@page` rule.
- Fonts: IBM Plex Sans 400/500/600, Latin and Cyrillic (`fonts/*.woff2`, OFL). `{ baseUrl: '/fonts' }` in the preview, `{ embedded }` (base64) in the PDF.

## Behaviour

1. **Markup and CSS** follow the reference as they are: class names, element types, the order of elements and the CSS of `resume-a-en.html` go into `src/render.tsx` and `src/styles.ts`. Visual changes are made in the reference first, never only in code.
2. **Sections**, in this order, each left out when empty: header, summary, experience, education, skills, then one `cv-section--extra` per `additional` section in document order. Section titles come from `LABELS[locale]`: en `Summary`, `Experience`, `Education`, `Skills`; uk `Про мене`, `Досвід роботи`, `Освіта`, `Навички`. `additional` titles are the document's own.
3. **Header.** `h1.cv-name` = full name; `p.cv-headline` only when the headline is not empty; `ul.cv-contacts` with, in this order and only when not empty: email as `<a href="mailto:…">address</a>`, phone as `<a href="tel:…">` (the `href` keeps only `+` and digits, the text stays as written), location as text, each link as `<a href="…">` whose text is the link without the scheme, `www.` stays, and without a trailing slash (`https://github.com/x/` → `github.com/x`). No empty `<li>`; no `ul` when there is nothing to list.
4. **Dates.** `YYYY` prints as is; `YYYY-MM` prints the month abbreviation and the year: en `Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec`; uk (CLDR, without dots) `січ лют бер квіт трав черв лип серп вер жовт лист груд`. A range is `start – end` with a spaced en dash; `current` replaces the end with `Present` / `дотепер`. Only one side known → that side alone. Nothing known → no `.cv-entry__dates` element.
5. **Experience entry** (`article.cv-entry`): `h3.cv-entry__title` = title; the dates span; `p.cv-entry__meta` with `span.cv-entry__org` = company and `span.cv-entry__location` only when there is a location (no `p` when both are empty); `ul.cv-entry__bullets` only when there are bullets.
6. **Education entry** (`article.cv-entry.cv-entry--compact`): title = degree, org = institution; without a degree the institution is the title and there is no meta line.
7. **Skills**: `ul.cv-skills`, one `li` per skill. **Additional**: `ul.cv-list`, one `li` per item.
8. **Safety.** All text is escaped (React); links use only the schemes the document schema allows; no `<script>`, no inline event handlers, no external URLs besides `baseUrl` fonts. React keys are item ids, so duplicate texts do not collide.
9. **Preview = PDF.** The same CSS serves both; the preview shows one continuous A4-wide page, only the PDF paginates.

## Acceptance examples

Test files in `packages/cv-template/test/` (`template.acceptance.test.ts` and `ats.acceptance.test.ts`; the ATS test uses real Chromium and `unpdf`). Test names start with the example id. "The en sample" is a `CvDocument` with the content of `resume-a-en.html`, "the uk sample" one with the content of `resume-b-uk.html`; both live in `test/fixtures/`.

- **TPL-1 — the en reference.** `renderCvBody(en sample)` has the sections with classes `cv-section--summary`, `--experience`, `--education`, `--skills` and three `--extra` in this order; their `h2` texts are `Summary`, `Experience`, `Education`, `Skills`, `Certifications`, `Languages`, `Volunteering`; the first position's dates read `Mar 2023 – Present`, the second's `Jan 2021 – Feb 2023`; the first education entry's `2017 – 2019`.
- **TPL-2 — the uk reference.** `renderCvHtml(uk sample, { fonts: { baseUrl: '/fonts' } })` starts with `<!DOCTYPE html><html lang="uk">`, has `<title>Олег Савчук — Frontend-розробник</title>`, section titles `Про мене`, `Досвід роботи`, `Освіта`, `Навички`, and the first position's dates `вер 2022 – дотепер`.
- **TPL-3 — empty elements are not rendered.** A document with an empty headline, an empty phone and location, no links, a position without dates, location and bullets, no skills and an empty summary → the HTML has no `cv-headline`, no empty `<li>`, no `cv-entry__dates`, no `cv-entry__location`, no `cv-entry__bullets`, no `cv-section--skills`, no `cv-section--summary`, and no `–`.
- **TPL-4 — dates.**
  | locale | start     | end       | current | printed                |
  | ------ | --------- | --------- | ------- | ---------------------- |
  | en     | `2020-05` | null      | true    | `May 2020 – Present`   |
  | en     | `2019`    | `2021-02` | false   | `2019 – Feb 2021`      |
  | en     | `2018-07` | null      | false   | `Jul 2018`             |
  | uk     | `2023-11` | `2024-01` | false   | `лист 2023 – січ 2024` |
  | uk     | `2022-09` | null      | true    | `вер 2022 – дотепер`   |
- **TPL-5 — contacts and links.** Email `iryna@example.com`, phone `+1 (555) 010-0142`, location `Kyiv, Ukraine`, links `https://github.com/ikovalenko/` and `https://www.linkedin.com/in/iryna` → `<a href="mailto:iryna@example.com">iryna@example.com</a>`, `<a href="tel:+15550100142">+1 (555) 010-0142</a>`, `Kyiv, Ukraine`, `<a href="https://github.com/ikovalenko/">github.com/ikovalenko</a>`, `<a href="https://www.linkedin.com/in/iryna">www.linkedin.com/in/iryna</a>`, in this order.
- **TPL-6 — ATS readability, en and uk.** Each sample → `renderCvHtml` with embedded fonts → Chromium `page.pdf(PDF_OPTIONS)` → text with `unpdf`: every section title appears as a whole word (`Experience`, not `E x p e r i e n c e`; `Досвід роботи` as written); the titles appear in document order; for every position, its printed dates appear after its title and before the next position's title.
- **TPL-7 — text is text.** A bullet `<script>alert(1)</script>` renders escaped; the HTML contains no `<script`.
- **TPL-8 — one page for both.** `renderCvHtml(doc, opts)` contains `<body>` + `renderCvBody(doc)` + `</body>` and exactly one `<head>`, also when a bullet reads ``Saved $$ on hosting: a $& b $` c $' d`` (a string replacement would expand those sequences; build the expected value by concatenation, not with a replace call).

The existing `test/pdf-options.test.ts` (A4 size, 17 mm margin, the frozen `PDF_OPTIONS`) stays as it is.

## Definition of done

The acceptance examples pass; the rendered en and uk samples look like the reference files side by side in a browser at A4 width and at 360 px inside the preview; the PDF endpoint (pdf.md) prints the same HTML; this spec matches the code.

## Required tests

The acceptance examples; a duplicate bullet text in one position renders twice without a React key warning.
