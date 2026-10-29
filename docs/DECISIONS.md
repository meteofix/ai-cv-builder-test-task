# Architecture decisions

This log keeps the decisions that involved a real trade-off. Smaller choices (JSON shapes, ids, status codes, cookie flags, limits) live in the module specs under [`docs/specs/`](specs/). Each record lists the options that were considered and why one was chosen; revisions keep the history as "was → now, because".

## Index

| #                                                                                   | Decision                                                                                |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [001](#001-react-spa-behind-nginx-on-one-origin)                                    | React SPA (Vite) behind nginx on one origin                                             |
| [002](#002-background-worker-inside-the-api-process)                                | Background worker inside the API process                                                |
| [003](#003-job-queue-in-a-postgres-table)                                           | Job queue in a Postgres table (`FOR UPDATE SKIP LOCKED`)                                |
| [004](#004-polling-while-a-job-is-active)                                           | Progress by polling while a job is active                                               |
| [005](#005-pdf-text-extraction-in-a-worker-thread-text-only-storage)                | PDF text extraction in a worker thread; only the text is stored                         |
| [006](#006-two-step-generation-from-verified-facts)                                 | Two-step generation: verified facts first, writing second                               |
| [007](#007-hallucination-guard-mechanical-checks-llm-judge-questions)               | Hallucination guard: mechanical checks, LLM judge, questions                            |
| [008](#008-model-roles)                                                             | Model roles: Haiku extracts, Sonnet writes, Opus judges                                 |
| [009](#009-unsupported-content-becomes-a-question)                                  | Unsupported content is removed and becomes a question                                   |
| [010](#010-structured-output-and-a-per-job-llm-call-budget)                         | Structured output with zod; retries owned by the LLM client under a per-job call budget |
| [011](#011-one-cv-document-with-optimistic-locking-read-only-editor-during-ai-jobs) | One CV document with optimistic locking; read-only editor during AI jobs                |
| [012](#012-single-flight-autosave)                                                  | Single-flight autosave without resetting the form                                       |
| [013](#013-staged-draft-assembled-on-read)                                          | Staged draft assembled on read from stored facts                                        |
| [014](#014-extra-sections-are-copied-verbatim)                                      | Extra CV sections are copied verbatim                                                   |
| [015](#015-the-cv-keeps-the-source-language)                                        | The CV keeps the source language (en/uk)                                                |
| [016](#016-server-side-sessions-in-postgres)                                        | Server-side sessions in Postgres                                                        |
| [017](#017-ownership-enforced-in-data-access)                                       | Ownership enforced in data access; foreign ids return 404                               |
| [018](#018-defense-in-depth-with-framework-built-ins)                               | Defense in depth with framework built-ins                                               |
| [019](#019-one-html-template-for-preview-and-pdf)                                   | One HTML template for preview and PDF; Chromium in the API container                    |
| [020](#020-embedded-fonts-loaded-before-printing)                                   | Embedded fonts, loaded before printing                                                  |
| [021](#021-contracts-as-zod-schemas-in-cvshared)                                    | Contracts as zod schemas in `@cv/shared`; OpenAPI derived from them                     |
| [022](#022-rfc-9457-errors-with-machine-readable-codes)                             | RFC 9457 errors with machine-readable codes                                             |
| [023](#023-template-questions-and-targeted-answers)                                 | Template questions; typed answers applied without the LLM                               |
| [024](#024-tests-real-postgres-and-chromium-fake-llm-fixed-acceptance-examples)     | Tests: real Postgres and Chromium, fake LLM, fixed acceptance examples                  |
| [025](#025-agent-rules-in-agentsmd)                                                 | Agent rules in `AGENTS.md`                                                              |
| [026](#026-light-review-on-every-commit-heavy-review-before-merge)                  | Light review on every commit, heavy review before merge                                 |

---

## 001. React SPA behind nginx on one origin

**Context.** The frontend choice decides how many services run in compose and how the session cookie reaches the API.
**Options.**

- Vite + React SPA served by nginx, which also proxies `/api` — one origin, fast build, one more container.
- The same SPA served by NestJS — one container fewer, but the frontend ships inside the API release and SPA fallback routing lives in Fastify.
- Next.js with client components only — familiar, but a second Node server and SSR we would not use.

**Decision.** Vite + React SPA behind nginx. The whole app is behind a login, so SSR and SEO add nothing. One origin means an httpOnly session cookie without CORS, and relative `/api` URLs keep working when the app is opened from a phone over the LAN.

## 002. Background worker inside the API process

**Context.** Generation takes tens of seconds and must survive page reloads and API restarts.
**Options.**

- Worker inside the API process — nothing extra to run, but an API restart interrupts the in-flight LLM call.
- Separate process from the same image — isolation and independent scaling, but more wiring and one more service to start in order.
- Separate application — duplicated configuration and entities.

**Decision.** In-process worker as a module without HTTP dependencies. Job state lives in Postgres, so a restart costs at most the interrupted call: the job resumes from the last completed step. Moving the worker out is a second entry point (`worker.ts`) with no change to the logic.

## 003. Job queue in a Postgres table

**Context.** Jobs need to be claimed atomically, retried, recovered after crashes and shown to the user.
**Options.**

- Own `generation_jobs` table claimed with `FOR UPDATE SKIP LOCKED`.
- pg-boss — mature retries, but its own job states duplicate ours and run outside our ORM transactions.
- BullMQ with Redis — one more container and job state split across two stores.

**Decision.** Own table. The job row is the queue entry, the progress record and the source of the status shown in the UI. A lease with a heartbeat recovers jobs from dead workers; every write is fenced by `locked_by`, so a worker that lost its lease cannot finalize; attempts are bounded and end in `failed` with a user-visible reason. Finalization (document, questions, job status) is one transaction.

## 004. Polling while a job is active

**Options.**

- Polling every 1.5 s.
- Server-Sent Events — needs `proxy_buffering off`, reconnection handling, and the server would still have to learn about job changes (LISTEN/NOTIFY or polling the database).

**Decision.** Polling, and only while a job is active. It survives reloads for free and is easy to test. SSE for streaming sections is listed as a next step.

## 005. PDF text extraction in a worker thread; text-only storage

**Context.** Uploaded PDFs are untrusted; a crafted file can burn CPU or memory, and the worker shares the event loop with HTTP.
**Options.**

- Extract in the request thread with size and page limits — synchronous CPU work cannot be interrupted.
- Extract in `worker_threads` with a timeout and `resourceLimits`.
- Extract as the first job step — requires storing the binary until the job runs.
- Send the PDF to Claude directly — better with multi-column layouts, but the model and the validator would see different texts.

**Decision.** `worker_threads` with a 10 s timeout and a memory cap; empty, scanned, encrypted or broken files get a clear 422. Only the extracted text is stored, never the binary. Known limitation: text order in multi-column PDFs.
**Revision.** The text order now follows the page layout (decision 029).

## 006. Two-step generation from verified facts

**Context.** The model may rephrase and restructure but must not invent facts.
**Options.**

- Two steps: an extractor returns typed facts with verbatim quotes; the server verifies them; the writer sees only verified facts, and the server copies structural fields itself.
- One call returning facts and prose together — cheaper, but the prose is written while the model sees unverified text.
- One call from source to CV, validated against the raw text afterwards — cheapest, but invented fields are caught after the fact and facts moved between jobs pass.

**Decision.** Two steps. Companies, titles, dates, institutions, skills and contacts are copied by the server from verified facts; the writer's output schema has no fields for them, so they cannot be invented. Steps are persisted, so a crash resumes from the last completed step.
**Revision.** Verified facts → an author and a reviewer, because the rules, not the model, lost content on real CVs (decision 035).

## 007. Hallucination guard: mechanical checks, LLM judge, questions

**Context.** We need guarantees without turning every normal CV into a pile of questions.
**Decision.** Code guards what can be checked mechanically — provenance, names, dates and numbers; an LLM judge evaluates meaning; everything else becomes visible to the user as a question. Content the extractor missed is not dropped silently: source lines not covered by any fact are listed as not recognized.

- Mechanical: every fact quote must be found in the normalized source (exact, then letters-and-digits only, always on whole tokens, so `Java` is not found inside `JavaScript`); structural values must appear in their quote as whole tokens (dates: the year); a bullet may reference only facts of its own position; metrics (`%`, `+`, `x`, currency, `k/M/B`) must appear in the quotes the text references, standalone numbers anywhere in the source, and tokens glued to letters (S3, ES6, p95) are not checked; experience order must be a permutation of known ids; instruction-like fragments (delimiters, the extractor's `ignoredInstructions`, a short list of explicit patterns) invalidate the facts quoted from them.
  **Revision.** The writer no longer orders the experience, so there is no order to check (decision 033).
- Semantic: one judge call checks that every bullet and summary sentence follows from the quotes it references — role keywords absent from the source, unsupported qualitative claims, wrong references, duties moved between jobs, invented traits or domains, distorted time or negation. Missing verdicts fail closed.

**Revisions.**

- Was: a deterministic validator with an optional judge → the judge became a mandatory second layer, because semantic exaggeration ("was on the team" → "led the development") is invisible to string checks.
- Was: tech and claim lexicons, a capitalized-word heuristic, computed years of experience, month dictionaries in two languages → now: only the mechanical checks above, because broad heuristics produced false questions on clean CVs and duplicated what the judge does better. If evals show the judge missing technology keywords, a deterministic lexicon is the next step.
- Was: numbers after a product name ("Next.js 14", "Python 3") exempt from checks → now: no exemption, because it would let an invented version pass when the source says only "Next.js".
  **Revision.** Code now checks only contacts against the source; the reviewer checks every item of the CV, and what it cannot confirm becomes a fix or a question (decision 035).

## 008. Model roles

**Options.** One model for everything · Opus writes and Sonnet judges · Haiku extracts, Sonnet writes, Opus judges.
**Decision.** Haiku 5.5 (effort low) extracts, Sonnet 5.5 (medium) writes, Opus 5.5 (high) judges; all configurable via env. The judge must be stronger than and different from the writer so it does not agree with itself; its input is small. Bullet writing gains little from Opus, while Sonnet 5.5 costs half as much per token and is rated faster in Anthropic's model overview.
**Revision.** Was: Opus writes, Sonnet judges → now: Sonnet writes, Opus judges, for the reasons above.

## 009. Unsupported content becomes a question

**Options.** Rewrite once under a constraint, then ask · ask directly.
**Decision.** Anything that fails the mechanical checks or the judge is removed from the CV and becomes a question that shows the removed text; doubt counts as unsupported. Nothing is dropped silently.
**Revision.** Was: one constrained rewrite before asking → now: ask directly; the rewrite is an extension.

## 010. Structured output and a per-job LLM call budget

**Options.** `messages.parse()` with `zodOutputFormat` · strict tool use (we have no tools) · JSON in text parsed with zod.
**Decision.** `messages.parse()` with zod schemas plus our own semantic checks; an invalid answer is re-requested with the validation error (at most twice). SDK retries are disabled: every retry (transport errors honouring `retry-after`, schema re-asks, job attempts) goes through our client and increments `llm_calls` on the job row, capped at 12 per job; reaching the cap fails the job with a reason. Calls time out after 180 s; refusals and authentication errors are not retried. The server-side refusal fallback (beta) is not used in the critical path.
**Revision.** Was: SDK retries plus job retries plus schema re-asks → now: one counted budget, because the three layers multiplied.

## 011. One CV document with optimistic locking; read-only editor during AI jobs

**Options.**

- One JSONB document with a `version` column.
- One row per section with its own version.
- Normalized tables for entries and bullets.

**Decision.** One JSONB document validated by zod, a compare-and-set update on `version` (`WHERE id = … AND version = …`), and `PUT` of the whole document. While an AI job runs, the editor is read-only and the server rejects `PUT` with 409 `JOB_ACTIVE`; the card being updated shows "Updating…". A stale `PUT` from another tab gets 409 `VERSION_CONFLICT`, and the client reloads the latest version with a message instead of overwriting it.
**Revisions.** Was: MikroORM optimistic locking on `version` → now: an explicit compare-and-set statement, because the API and the worker both replace the document in one native update, which also has to set `updated_at` itself. Was: read-only editor → lock only the card being updated, with compare-and-set per section or card → now: read-only again, because per-unit compare-and-set (dirty-unit tracking, server comparison, extra error codes and tests) cost more than the short window of editing it would allow, while the user is answering a question anyway. Editing other sections during an AI job is a next step.

## 012. Single-flight autosave

**Decision.** Debounced autosave with at most one `PUT` in flight; changes made meanwhile are sent next with the updated version. After a successful save the form is not reset — only the version and the last saved snapshot change. The form is reset only on 409 `VERSION_CONFLICT` and after an AI job completes.
**Revision.** Was: save, then reset the form from the response → now: single-flight without reset, because the first version lost keystrokes typed during the request and could conflict with its own parallel save.

## 013. Staged draft assembled on read

**Context.** Generation runs several sequential LLM steps and can take tens of seconds; after extraction the server already has everything it copies verbatim.
**Options.**

- Write a partial document after extraction — needs a "complete" flag for PDF, the list and `PUT`.
- Assemble a draft on read from stored facts with the same skeleton function finalization uses.

**Decision.** Assemble on read: while `document` is empty, `GET /api/cvs/:id/draft` builds the draft from stored facts with the same skeleton function finalization uses, and the preview shows it with "Writing…" placeholders. The draft is served by the generation module, which owns the facts. The document has no intermediate state. A one-time reshuffle of the preview after finalization (relevance order, skill selection) is accepted.

## 014. Extra sections are copied verbatim

**Decision.** Sections beyond the required five (certifications, languages, projects, volunteering) are extracted as facts with the section heading from the source and copied verbatim into `additional` without the writer; the judge does not check verbatim copies. One item per source line; dates stay inside the text; a heading not found in the source falls back to "Additional information". Self-descriptions ("About me", or the title line under the name) become `profile` facts that only the summary may use.
**Revision.** Was: only the five sections named in the task → now: extra sections are kept, because dropping them throws away what the user wrote.

## 015. The CV keeps the source language

**Options.** Keep the source language · translate to English.
**Decision.** The extractor detects `en` or `uk` (anything else → `en`); the writer writes in the source language; the template takes section titles, month names and "Present" from an en/uk dictionary. Translation would break the deterministic checks ("Приватбанк" → "PrivatBank"). The editor UI stays in English and shows the CV language. Mixed-language CVs may be detected imprecisely; a language selector is a next step.

## 016. Server-side sessions in Postgres

**Options.**

- Server-side sessions: a random token in an httpOnly cookie, its SHA-256 in the database.
- JWT in a cookie — needs a second secret (a key generated at startup would log everyone out after a restart) and cannot be revoked on logout.
- Encrypted cookie sessions — the same key problem.

**Decision.** Server-side sessions. The task allows exactly one secret (`ANTHROPIC_API_KEY`), and logout really revokes the session. Passwords are hashed with argon2id.

## 017. Ownership enforced in data access

**Options.** Explicit owner-scoped repository methods · MikroORM global filters (implicit; the worker has no user) · Postgres row-level security (heavy with connection pooling).
**Decision.** Every CV access goes through `findOwned(id, userId)`; child records are reached only through an owned CV; foreign and missing ids both return 404. A table-driven test calls every CV route as a second user.

## 018. Defense in depth with framework built-ins

**Decision.** NestJS built-ins: `enableCsrfProtection()` (Fetch Metadata with an Origin/Host fallback) on top of `SameSite=Lax` cookies, `useSecurityHeaders()`, and `@nestjs/throttler` on sign-up and login. nginx passes the original `Host` (needed by the CSRF fallback when browsers omit `Sec-Fetch-Site`, e.g. on a LAN over HTTP) and overwrites `X-Forwarded-For` with `$remote_addr` instead of appending, so a client cannot spoof its address to bypass the login limit.

## 019. One HTML template for preview and PDF

**Options for the renderer.** Playwright in the API container · a separate Chromium service (Gotenberg) · Puppeteer · a non-HTML PDF library (a second template).
**Decision.** `@cv/cv-template` renders the CV to HTML with React (`renderToStaticMarkup`); the same string feeds the preview and Chromium. Playwright runs in the API container: one browser per process, a fresh offline context per render, at most two renders at a time, 15 s timeout. The preview is an `<iframe sandbox="allow-same-origin">` without scripts: the shell with styles is set once, then the app writes the body directly, so typing does not reload or flicker the preview. The heavier API image is a conscious trade-off. The preview shows one continuous A4-wide page; only the PDF paginates.
**Revision.** Was: replace the iframe `srcdoc` on every change → now: write into the body of a same-origin iframe, because every replacement reloaded the frame, reset scrolling and broke font loading.

## 020. Embedded fonts, loaded before printing

**Decision.** IBM Plex Sans (OFL, Latin and Cyrillic, 400/500/600) ships with the template: the preview loads it from the same origin, the PDF embeds it as base64. The PDF page blocks its own scripts with a CSP, the network is off, and the renderer waits for `document.fonts.ready` and checks the font before printing; otherwise it fails with 503 instead of printing a fallback font.
**Revision.** Was: JavaScript disabled in the PDF page → now: page scripts blocked by CSP while our own evaluation still runs, because waiting for fonts needs it.

## 021. Contracts as zod schemas in `@cv/shared`

**Options.** zod schemas and a route table in the shared package · plus generated OpenAPI · OpenAPI-first with code generation.
**Decision.** zod schemas are the single source for request validation (NestJS `StandardSchemaValidationPipe` with `@Body({ schema })`), LLM output, the typed web client and the mock API. Swagger UI at `/api/docs` is derived from the same schemas.

## 022. RFC 9457 errors with machine-readable codes

**Decision.** Errors are `application/problem+json` with a stable `code` and a `requestId`; the frontend maps codes to messages and shows the request id on server errors.

## 023. Template questions and targeted answers

**Options for question text.** Deterministic templates · written by the LLM (one more unverified output shown to the user).
**Options for answers.** Typed answers applied deterministically and text answers regenerating only their position · everything through the LLM · append-only bullets.
**Decision.** Questions are generated once, from templates: gaps (dates, missing fields, no achievements), vague facts flagged by the extractor, and removed claims. Typed answers (dates, a missing field) are applied without the LLM. A text answer becomes a fact, and only the AI-written bullets of its position are regenerated and re-checked; user-written bullets stay. If regenerated content fails the checks, the question shows "partially applied". Answers are processed one at a time.

## 024. Tests: real Postgres and Chromium, fake LLM, fixed acceptance examples

**Options for the database.** Postgres from compose with a dedicated test database · Testcontainers · an in-memory substitute (no `SKIP LOCKED`, JSONB or partial indexes).
**Decision.** Integration tests run against real Postgres (a database whose name contains `_test`) and real Chromium, with the Anthropic client replaced by a scripted fake. Every spec has acceptance examples that are fixed tests; a test setup check fails with one clear message when the database or Chromium is missing. The template package renders sample CVs through Chromium with the same PDF options as the API and checks ATS readability: section titles extract as whole words, and sections and dates keep document order. The PDF endpoint test checks that IBM Plex Sans is embedded. Browser end-to-end tests are a next step.

## 025. Agent rules in `AGENTS.md`

**Decision.** Rules for coding agents live in `AGENTS.md` at the root and in each package — a neutral convention for the agents used on this project: Claude Code during development and Codex for the review before merge. The repository keeps no `CLAUDE.md`, so the agent rules have a single source.
**Revision.** Was: `CLAUDE.md` → now: `AGENTS.md`, a convention shared by the agents we use.

## 026. Light review on every commit, heavy review before merge

**Context.** Coding agents write the code in parallel branches; review has to catch problems without making every commit slow.
**Options.** The full check and the strongest reviewer on every commit · light checks on every commit and a heavy gate before a branch is merged.
**Decision.** Every commit runs lint, typecheck and the tests of the changed package, and a reviewer agent reads the staged diff. Before a branch is merged: the full `pnpm check`; a mutation check that breaks critical code one change at a time and confirms a test fails each time; and a review by Codex — a model from another vendor, so its blind spots differ from those of the agent that wrote the code. Review findings are kept verbatim and answered one by one; an unresolved blocking finding stops the merge.
**Revision.** Was: the full check and an Opus reviewer on every commit → now: light checks per commit and the heavy gate before merge, because minutes of waiting and usage limits on each of 20–30 commits outweighed the benefit, while a reviewer from another vendor adds independence.

## 027. The extractor answers in groups per employer

**Context.** On real CVs one employer often has several consecutive positions under one company line, with bullets shared by all of them. A flat list of facts made the model link every bullet to a position by id and repeat the company in every position's quote; one wrong link or a company line outside the quote lost the position, its company or its bullets.
**Decision.** The extractor returns experience as the CV lays it out: per employer the company and its line, the positions with their own lines, and the bullets with the index of their position or "the whole group". A deterministic function flattens this into the existing facts and assigns every id; a position's company is checked in the group line when that line stands before the position with nothing of another company in between; a long company name may wrap over up to three lines, as long as the name itself starts on the first and ends on the last. The writer, the judge, "Not in your CV" and the document schema are unchanged. Owner's decision, 2026-10-29 (task R0-EXTRACT-NESTED).

## 028. No cascade: achievements outlive a dropped position

**Context.** An achievement whose position was dropped (its quote not found) used to be dropped too, so one mis-copied title line silently removed a job and all its bullets.
**Decision.** Such an achievement goes to the first kept position of its group, else to the nearest kept position above it in the source (never across a section heading), else it stays without a position and is listed under "Not used". The judge still checks the placement (`moved_between_jobs`): the dropped position's line reaches it among the unrecognized lines. Until the judge knows company groups (decision 032), a bullet placed in its group under a position that is not the nearest one above it is usually rejected and becomes a question: it fails closed. Owner's decision, 2026-10-29 (task R0-NO-CASCADE).

## 029. PDF text follows the page layout

**Context.** PDF.js returns text in content-stream order. Two-column CVs came out with the sidebar and the main column interleaved by the generator's paint order, page 2 sub-headings far from their bullets, a header band at the end, and a right-hand column of dates after the bullets it belongs to; the extractor then quoted lines that do not belong together, and dates fell out of their position's quote.
**Options.** Keep the stream order · a one-gutter split of the whole page (failed on a full-width header and on a date column) · bands and gutters with a side-column rule · an external layout engine (a new dependency, larger attack surface in the worker).
**Decision.** Rows by baseline; a gutter is an empty vertical strip crossed by the fewest rows (never more than a tenth); rows that cross it cut the page into bands; a band is a short table or a marker list, a narrow side column in short blocks attached to its entry lines, or two columns read one after the other. A page without a gutter, or one too large for a CV, keeps the stream order, so simple PDFs read as before. Chosen by its effect on the whole dev corpus (no CV got worse); tables, scans and more than two columns are out of scope. Owner's task R0-PDF, 2026-10-29.

## 030. One repair request for misquoted facts

**Context.** A fact whose quote is not copied exactly is dropped; on real CVs this hit position lines most (a title with its dates), and before decision 028 it took the job's bullets with it.
**Decision.** After the checks, the facts dropped as `quote_not_found` or `field_not_in_quote` go back to the extractor once, each with its problem in words. The model may only give a new quote or a new value for a skill or contact; it cannot add facts, and every fix is verified like the original. One request at most per generation, inside the job's call budget; when it fails on the model's side, the first extraction stands. A repaired quote may land on another job's bullet, which the judge checks as it checks the first pass. Owner's decision, 2026-10-29 (task R0-REPAIR).

## 031. A second extractor pass over uncovered lines

**Context.** One extraction of a long CV left most of a sidebar and of the second page uncovered (skills, wrapped lines, sections the model skipped); they surfaced only as "Not recognized".
**Decision.** When more than 15 % of the content lines stay uncovered after the repair, the extractor reads only those lines, with the jobs found so far as labels, and its answer is verified together with the first pass. The threshold was chosen on the dev corpus: clean one-column CVs stay below it, CVs that lost a column or a page are far above. The pass is optional (a failure keeps the first pass) and counts against the job's call budget. Owner's decision, 2026-10-29 (task R0-COVERAGE).

## 032. Positions at one company are shown as one block

**Context.** A company line above several titles with shared bullets is common; the flat document showed the company again for every title, put the shared bullets under the newest title, asked "what did you achieve?" for the others, and the judge rejected a shared bullet for standing under a sibling title.
**Options.** A) No schema change: consecutive positions with the same company form a block in the template; shared bullets live on the block's first position. B) A company level in the document schema (a migration of stored documents and of the editor).
**Decision.** A. The template prints the company once, then each title with its dates, then the bullets (a position's own bullets under it; the first position's bullets after the last title when the others have none). No "no bullets" question for the positions of a block that shares its bullets (only its first position has any); for the judge a quote that follows a block's stacked titles stands under any of them, while a block whose titles have their own bullets keeps the literal placement. Limits of A: the document cannot tell bullets shared by the block from bullets of its first position alone, so the latter print after the last title too; a bullet added to another position of the block (an answer, a manual edit) switches the block to per-position bullets. Owner's decision, 2026-10-29 (task R0-GROUP).

## 033. The experience keeps the order of the source

**Context.** The writer ordered the positions by relevance to the target role, so a CV's chronology broke and grouped positions of one company could be split.
**Decision.** The writer chooses bullets and their order, not the order of the jobs; the document lists positions as the source does. The writer's output has no order field and the server has no order to check. Owner's decision, 2026-10-29 (task R0-ORDER).
**Revision.** The author lists jobs newest first and may put an older job first only with a reason the editor shows (decision 035).

## 034. Say when much of the CV could not be read

**Context.** A CV whose text came out garbled or half skipped ended up with dozens of "Not recognized" lines and no sign that half of it was lost.
**Decision.** `GET /not-in-cv` gains an optional `sourceCoverage` field (content lines, lines not recognized, `low`); the editor shows a warning with a link to "Not in your CV" and the hint to paste the text when more than a quarter of the content lines were not recognized. The threshold comes from the dev corpus: after the extraction fixes every CV there is at or below 15 %, while the failures before them were at 35–75 %. Additive API change; owner's decision, 2026-10-29 (task R0-SIGNAL).

## 035. v2: an author and a reviewer instead of verified facts

**Context.** The task says the AI may rephrase and restructure but must not invent facts. The fact-grounded flow (006, 007, 027–031) enforced that with a deterministic validator our own brief added: every fact had to be quoted, every structural value found in its quote, every sentence judged against the quotes it cited. On real CVs the losses came from these rules, not from the model: a misquoted position took its bullets with it, a company on its own line above three titles was erased, a flat fact list lost skill groups and projects, and about half of the judge's rejections were faithful rewrites (R0 report, 2026-10-29). Owner's plan v2, 2026-10-29.
**Options.** A) Keep the facts and loosen the rules one by one. B) Two calls: an author that reads the whole source and writes the CV, citing source segments, and a reviewer that sees the whole CV against the source and returns only problems; code keeps the contracts, the contacts and the accounting. C) One call that writes and checks itself.
**Decision.** B. The source becomes numbered segments (lines, or sentences of a long line); instruction-like segments are cut before any model sees them. The author keeps a good item word for word (`text: null`, the server copies the segments) and rewrites only where it helps, citing its evidence; it also says what it left out and why, what to ask, and why an older job leads when it does. The reviewer answers with `fix` (preferred) or `ask` per item, and judges nothing but support: not relevance, selection, order, style or length. Code: segments, schemas plus checks with one re-ask, exact contacts (email, phone and links must be in the source), the kept text, the review applied, the accounting of every content segment ("Not in your CV"), the safeguard limits. Nothing over a limit is cut, and nothing the source says disappears without showing in the CV or the panel. C was not tried: one call cannot be asked to doubt what it has just written.
**Measured (dev: 11 CVs + the owner's CV as AI Engineer + 5 free-text inputs; Opus for both roles, effort medium).** Blind pairwise against main, judged by Opus in both orders: v2 better overall on 17 of 17, never worse on faithfulness (8 better, 9 equal); claims the judge found unsupported: 6 in v2 (all the headline: the target role for a person from another profession, the planned rule), 33 in main. Reviewer test (six kinds of planted inventions: technology, inflated scope, date, a bullet moved to another job, a number, a changed unit or qualifier): 59 of 59 found; on the untouched answers 1 finding over 563 items. No re-ask in the last round. One generation: 9–60 s (main 15–62 s), about $0.05–0.24 (main about $0.04, mostly cheaper models).
**Costs.** A generation costs more (two Opus calls instead of Haiku, Sonnet and Opus). Nothing mechanical checks the content any more: faithfulness rests on the reviewer, measured by the evals, not proven by code. The structured-output grammar has a size limit, so the schema sent to the service is plain and the checks that need the source (ids, sizes after kept text, date formats) run in code and come back as a re-ask.

**Revision.** A kept item is `text: ""`, not `text: null`, and the CV's lists are groups (decision 036).

**Revision (V2-Z4, the owner's decision on a Codex finding, 2026-10-29).** The reviewer gets one duty beyond support: the segments the author called headings, labels or decoration count as placed, so a short line of content filed there (a certificate, a language) would vanish with nothing to catch it. The reviewer now sees those the CV shows nowhere (`[heading.S…]`) and may answer `ask` with a reason for one that holds the person's content; code lists it in "Not in your CV" with "Add" (no question: there is no part to rewrite). Measured on the final dev answers with one extra entry planted among the headings: 6 of 6 planted lines the CV showed nowhere were reported (in 4 other plants the lines were too long to count as a heading, so code listed them anyway, or were still cited elsewhere); 1 report about a real heading line over 11 clean answers (a line with project dates). $0.46.

## 036. v2: one group block for every list; the author answers through a tool

**Context.** The owner's CV rendered from the Z1 output was complete but read worse than the original: the source's subsections inside a job and the records of projects and courses were flattened into one list, one source paragraph became two or three bullets, the summary was a near-copy of the person's text (960 characters, two grammatical persons), and the template kept a company block on one page, so page 1 held only the header and the summary (3 pages in total). Skill groups (Z2) had already shown that a titled group is what CVs use for structure.

**Options.** A) A typed form per case (job subsections, project records, course records). B) One building block for the whole document: a group `{id, title | null, items[]}`, one level deep. A job is a typed header and groups of bullets; skills are groups; an extra section is a list of entries, each a title, dates and groups of lines.

**Decision.** B. One untitled group is a plain list, so a document saved before is migrated without a visible change (`Migration20261029140000_item_groups`: flat bullets → one untitled group; an extra section's items → entries without a title or dates, 20 lines each). Item ids run across the groups of one list, so provenance follows an item that moves between groups. Grouping is the model's decision, written as rules in the author's prompt: keep the source's subsections by default (merge layout artifacts and one-item groups; a merged or dropped subsection is noted in `structureNotes`, which only the eval reads — merging loses no content, and technical notes would spoil the person's one line about the order, which stays about the order of jobs; content of a dropped subsection that is not in the CV is "left out" in the panel with its reason and "Add"), group an ungrouped job only when its list is long and has clear themes, skills from about 12. A group title is a claim: the reviewer checks it like an item; a doubtful title is fixed or dropped (its items stay). In the same slice, by the owner's decisions: compress, do not cut (one source item → one bullet of one or two lines; keep only what is already concise); a summary of about 400–600 characters written for the role, which matters more than keeping it word for word; page count and summary length are shown in the editor as advice, never enforced; the template may break inside a job or company block but never right after a title, and shows a company's overall dates in its header.

**The author's answer moved off the strict grammar.** The service compiles a structured-output schema into a grammar with a size cap, and the Z2 author schema was already at it: adding one string field to a bullet was refused ("compiled grammar is too large"). Without `null` alternatives, patterns, `$ref`s, length notes and most descriptions the grouped schema still did not pass with any margin, so: the author answers as the input of a tool call that is not `strict` (`tool_choice: auto` — Opus 5.5 refuses a forced choice — plus one line in the system prompt), validated by the same zod schema and `check`, with the existing single re-ask on any error. The reviewer's schema is small and stays on the grammar. Trade-off: the service no longer guarantees the author's JSON shape, so a malformed answer costs a re-ask (one more author call) instead of being impossible; the share of re-asked author answers is measured on every eval run and reported. If it goes above about 10 %, the next steps are a smaller schema or splitting the answer.

**Eval changes.** Each dev CV is judged for a realistic role of its own profession (one role for all measured the wrong thing). Pairwise comparison uses two judges, Opus and Sonnet, and counts a win or a loss only when both judges in both orders agree (`main` is written mostly by Sonnet, so the two can only be biased in opposite directions). The reviewer test plants subtle inventions written by Sonnet inside items (eight kinds: verb and role inflation, a dropped qualifier, a changed unit, a year moved by one, an added cause, a metric borrowed from another item, a team's result given to the person) and reports recall per kind. The compose report adds the page count of the real PDF, bullet lengths, titled groups and the titles not found in the source.

**After the Z2b review (owner, 29.10).** An extra entry holds at most 20 lines across its groups (`LIMITS.maxLinesPerEntry`, like the bullets of a job), in the document schema and in the check of the author's answer, so a longer answer is asked again, never cut (`Migration20261029140000_item_groups` splits a section saved before, which held up to 40 lines, into untitled entries of 20, so the CV looks the same and can still be saved). The author also may not cite segments on an entry or a skill group the document would drop (an entry with neither title nor line, a group with no skill): they would count as placed while appearing nowhere. Length gets no new mechanism: the owner found the Z2b PDF much better and 3 pages acceptable; what still read badly was one source paragraph split into a bullet and its continuation, and bullets of three lines. So the author's prompt says one source item is one bullet unless it holds two separate achievements, no bullet goes past two lines (about 230 characters; the earlier allowance of about 300 for a dense item made the three-line ones), and the prompt shows two invented before/after compressions that keep every number; there is no "shorten" loop, and the page count stays advice in the editor. Kept bullets carry the source's full stops and rewritten ones usually do not, so the code gives all bullets of a CV the ending most of them have (none on a tie), changing only that stop.

**Revision (V2-Z4).** The reviewer test has ten kinds, was eight: a self-assessment the source does not make and a changed scope ("providers and models" → "models", "all" → "some") were added, and the reviewer got the class `changed_scope`, because an external review of the owner's CV found a narrowed list the reviewer had let through.

## 037. v2: a content answer rewrites one group

_What counts as carried below is superseded by the revision at the end of this record (word for word, "Earlier wording…", the answer `applied`)._

**Context.** Until V2-Z3 a content answer (to a doubtful item, a vague job or the summary) ran the v1 flow: the answer became a verified fact and a writer regenerated the job's bullets from facts, checked by a judge. A CV written by the v2 author has no facts, so its content answers failed; and the v1 flow knew only flat bullets, so it would have flattened the groups of ADR 036.

**Options.** A) Regenerate the whole job (or the whole CV) with the answer. B) Rewrite only the part the question is about: one group of a job's bullets or of an entry's lines, or the summary, with the same author and reviewer as a generation.

**Decision.** B, with the smallest scope that answers the question (the owner's decision): a question about one item the review took out gets that one item back, and the author is shown its neighbours only as staying; a question about a job, a group or the summary may rewrite and add to it. A reviewer's question targets the group the doubtful item stood in (`p1-g2`, `a1-e1-g1`); a vague job's question targets the job, which resolves to its untitled group (or a new one), so new content never lands under a subsection title it was not checked against. The answer becomes the segment `A<n>`, stored with the analysis so later answers build on it; the author gets the whole source, the answers and only the part, and writes its new items, which the code checks (known segments, limits, the room the job or entry has left — a miss is asked again); the reviewer checks them against the source and the answers; the code puts them first and the person's own items after, and touches nothing else (new bullets take the CV's existing full-stop style rather than re-aligning the CV). Nothing disappears silently (the owner's decision): an item the AI wrote that a rewritten part no longer carries (no new item cites all its segments) joins "Not in your CV" with the reason "Taken out when the CV was updated from your answer" and "Add", through the existing accounting, and the answer is `partial`; an item the reviewer asks about stays only when the author kept it word for word with the same segments as an item the part already showed (text the CV held); the summary counts as carried when its new sentences together cite the old one's segments. An item put back from "Not in your CV" with "Add" is the earlier CV text, possibly an AI rewrite, and becomes the person's own (no segments), like any other "Add". The question and the item it was about are shown to both models as context in `<cv_question>`, never as evidence; an answer that reads as an instruction is stored but never shown to a model. A doubtful skill group is no longer a question (an answer cannot rewrite a list of skills): it goes to "Not in your CV" with the reviewer's question. Trade-off: an answer that would better restructure the job (a new subsection, a merge) cannot; the person can still edit, and a structural change belongs to a new generation. The v1 answer modules (writer, judge, prose checks, skeleton, source facts) are deleted.

**Revision (V2-Z4, the owner's decision on a Codex finding, 2026-10-29).** An earlier AI item counted as carried when a new item cited all its segments, but citing a segment is no proof that the rewrite kept all of the item ("Built billing APIs and mentored two interns" → "Built billing APIs" kept S1). Now every earlier AI item the new version does not keep word for word goes to "Not in your CV" as "Earlier wording, replaced when the CV was updated from your answer" with "Add", and the answer stays `applied` (with a note); `partial` means only that new text was left out. Trade-off: after an answer the panel holds the earlier wording of the part, often close to the new text.

## 038. v2: evidence of level, a continued line, and what the author does not reprint

**Context.** An external review of the owner's CV (V2-Z4) found that compression had taken out what shows a person's level — "from scratch", "self-initiated", for whom a system was built, "closed every finding" — while keeping adjectives; that a PDF page starting in the middle of a job read as the previous job's bullets; and that the author spent about 60 s of a 70 s generation writing about 7 800 tokens, part of them skill lists it reprinted because a narrow column had wrapped names across lines ("AI" / "agents").

**Decision.** Prompt, not code, for what the author writes: compress lists, adjectives, repetition and filler, never the evidence of level (the mechanism, the scale, the ownership) and never a number; a bullet is one or two lines, and at most three bullets in a CV, the strongest for the role, may take a third (the owner accepted three or four lines for items that were paragraphs of seven or eight; no stricter rule and no "shorten" loop). The PDF prints "<Company> — continued" ("— продовження" in Ukrainian) at the top of a page that starts inside a job; the template forces every page break itself (`paginate`, measured at the printed width in the rendering page), so the line is always where Chromium breaks. A skill group the author keeps may be marked `wrapped`: the server joins its lines before cutting them into skills, so the author keeps the group instead of reprinting it; only the author can tell a wrapped name from one name per line, so code does not guess. A bullet the review took out and an answer gives back returns to its place: the question's target carries `position` (its index in the group as the review saw it); the answer inserts it there, less the earlier items of that group not back yet, so answers in any order keep the review's order, and at the end when that group is gone or shorter now (the owner's decision V2-Q6).

**Trade-offs.** A company with several positions is printed as one block: the positions' titles and dates, then the bullets they share. A person reads it as intended, but a structured ATS parser that splits the text by position may attach the shared bullets to the last position of the block. This is deliberate: it keeps the source's structure and avoids repeating bullets under each title; the PDF text stays in reading order (ATS tests in `packages/cv-template`). The output tokens of the author are mostly its reasoning: keeping skill groups saved about 550 tokens on the owner's CV (7 764 → 7 215, 59 → 57 s); the larger lever is the effort level (decision 039).

## 039. v2: models and effort — Opus at medium writes, Opus at low reviews

**Context.** A generation took about 25 s (median of the dev corpus) and about 60–75 s on the owner's long CV, almost all of it the author's call, and most of the author's output is its reasoning rather than the CV. Faster settings were tried: a cheaper model and a lower effort, for each role (owner's plan v2 §4; the owner's rule, 2026-10-29: quality is a hard condition, and among the settings that pass it the fastest is chosen).

**How quality was compared.** Each variant ran on the dev corpus (11 CVs) and the owner's CV and was compared blind with the Opus/medium run by two judges (Opus and Sonnet), each in both orders; a win or a loss counts only when all four agree, the rest is a split. Because the models vary from run to run, a second independent Opus/medium run against the first gives the noise level (A/A). The reviewer was also measured by the reviewer test (planted inventions of ten kinds on the dev answers). Every variant's documents were read for defects the base does not have.

| author + reviewer                             | dev median                                | owner's CV | cost (median) | pairwise vs Opus/medium on dev: agreed W/L/S, judge votes W/L                     | reviewer test: found, false alarms | verdict                               |
| --------------------------------------------- | ----------------------------------------- | ---------- | ------------- | --------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------- |
| Opus/medium + Opus/medium (A/A: a second run) | 25 s                                      | 63–77 s    | $0.09         | 0/1/10, 7/8 — the noise level                                                     | 72/77, 4/130                       | base                                  |
| **Opus/medium + Opus/low**                    | 25–27 s (reviewer 2.3 s instead of 3.5 s) | 63 s       | $0.10         | 0/2/9, 5/9 — within noise                                                         | 76/76, 4/131                       | **chosen**                            |
| Sonnet/high + Opus/low                        | 20 s                                      | 48 s       | $0.07         | 1/1/9, 4/12 — worse than noise                                                    | —                                  | no                                    |
| Opus/low + Opus/medium                        | 20 s                                      | 32 s       | $0.07         | 0/1/10, 4/15 — worse than noise; drops details (honours, a "technical lead" line) | —                                  | no                                    |
| Sonnet/medium + Opus/medium                   | 15 s                                      | 23 s       | $0.05         | 0/7/4 — clearly worse; bullets cut mid-sentence, a link cut short                 | —                                  | no                                    |
| reviewer Sonnet/medium                        | —                                         | —          | —             | —                                                                                 | 74/78, 13/131                      | no (false alarms take true items out) |

**Decision.** The author stays on Opus at effort medium; the reviewer runs on Opus at effort low (`REVIEWER_EFFORT=low`), which found as many planted inventions with as few false alarms and stayed within the noise level in the pairwise comparison. Both stay configurable through the environment. One loss on a single CV is within the noise: the same Opus/medium author lost twice to an earlier run of itself on the owner's CV, the judges calling the two "nearly identical".

**Costs.** The time stays far from the owner's target (about 20 s median, about 35 s for the owner's CV): the settings that reach it lose quality beyond the noise, and the trade is shown above for the owner's decision. The generation screen shows its steps, and a reload keeps the job; streaming the CV's sections as they are written is the next step for perceived speed (README, "What next"). Not tried: a separate reader call, a parallel author per section (the task allows a generation to take a while).

## 040. What a job header cites but does not show goes to "Not in your CV"

**Context.** A second holdout of real CVs (V2-HOLDOUT2) showed a company description written on the dates line ("Sep 2026 – Oct 2026 | AI-first entertainment company, 100M+ downloads") and a "(promoted)" next to the dates. The job cites the line for its dates, so the accounting counted the whole line as placed, and the rest showed nowhere — not in the CV, not in "Not in your CV".

**Decision.** Accounting in code, prompts untouched, no new field (the owner's choice). For a line only job headers cite, code splits it at `|`, `·`, `•`, `;` (never at a dash, which joins a date range) and lists the fields the header does not show in "Not in your CV", with a reason, under the job. A field shows when it has a year of the jobs' dates, a word of four letters or more of their title, company or location, only counts (a duration), or no letter; a round bracket inside a shown field that does not show is listed too.

**Why it is not a heuristic of the guard.** It decides nothing about truth and cannot add a fact to the CV: it compares text only and chooses between "counted as placed" (the old behaviour) and "listed for the person to see". Each rule errs towards "shown", so a mistake is either the old hiding or a visible item the person can ignore.

**Known limits.** Counts alone ("300 clients") read as a duration and stay hidden; a description that shares a word of four letters or more with the title or the company stays hidden; a title the author rewrote from a conversational one shares no word and is listed; a work mode ("Full-time · Hybrid") is listed, since the CV has no place for it either; "Add" on such an item puts the text among the job's bullets, where a description reads like the person's own work. Next: a company-description field under the company's header, written by the author and checked by the reviewer.
