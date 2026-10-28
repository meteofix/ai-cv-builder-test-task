# packages/cv-template

The React template of the CV. The live preview and the PDF render the same HTML. Read the root `AGENTS.md` first.

## Rules

- Public API: `renderCvHtml(document, { fonts })` (the full page for the PDF), `renderCvBody(document)` and `renderCvShell({ fonts })` (the preview sets the shell once and swaps the body). Their signatures are frozen; change markup and CSS, not signatures.
- `PDF_OPTIONS` in `src/pdf-options.ts` is the one set of `page.pdf()` options for the PDF endpoint and the ATS test. Do not change it.
- Markup and CSS follow the reference in `docs/design/cv-template/` as it is. Empty elements are not rendered; a missing date shows nothing, not a dash.
- Fonts: IBM Plex Sans 400/500/600, Latin and Cyrillic, OFL (`fonts/OFL.txt`). The preview loads them by URL from the same origin, the PDF embeds them as base64 (`FontSource`). Section titles, month names and "Present" come from the en/uk dictionary by `document.locale`.
- No scripts in the output, no external requests. Links only with the schemes the document schema allows.
- The ATS test renders en and uk CVs through real Chromium with `PDF_OPTIONS`, extracts the text with `unpdf` and checks that section titles come out as whole words, sections keep their order and dates stay next to their positions.
- Node-only code (reading font files) lives in `src/node.ts`, exported as `@cv/cv-template/node`; the main entry stays browser-safe.
