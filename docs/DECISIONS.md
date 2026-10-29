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

## 007. Hallucination guard: mechanical checks, LLM judge, questions

**Context.** We need guarantees without turning every normal CV into a pile of questions.
**Decision.** Code guards what can be checked mechanically — provenance, names, dates and numbers; an LLM judge evaluates meaning; everything else becomes visible to the user as a question. Content the extractor missed is not dropped silently: source lines not covered by any fact are listed as not recognized.

- Mechanical: every fact quote must be found in the normalized source (exact, then letters-and-digits only, always on whole tokens, so `Java` is not found inside `JavaScript`); structural values must appear in their quote as whole tokens (dates: the year); a bullet may reference only facts of its own position; metrics (`%`, `+`, `x`, currency, `k/M/B`) must appear in the quotes the text references, standalone numbers anywhere in the source, and tokens glued to letters (S3, ES6, p95) are not checked; experience order must be a permutation of known ids; instruction-like fragments (delimiters, the extractor's `ignoredInstructions`, a short list of explicit patterns) invalidate the facts quoted from them.
- Semantic: one judge call checks that every bullet and summary sentence follows from the quotes it references — role keywords absent from the source, unsupported qualitative claims, wrong references, duties moved between jobs, invented traits or domains, distorted time or negation. Missing verdicts fail closed.

**Revisions.**

- Was: a deterministic validator with an optional judge → the judge became a mandatory second layer, because semantic exaggeration ("was on the team" → "led the development") is invisible to string checks.
- Was: tech and claim lexicons, a capitalized-word heuristic, computed years of experience, month dictionaries in two languages → now: only the mechanical checks above, because broad heuristics produced false questions on clean CVs and duplicated what the judge does better. If evals show the judge missing technology keywords, a deterministic lexicon is the next step.
- Was: numbers after a product name ("Next.js 14", "Python 3") exempt from checks → now: no exemption, because it would let an invented version pass when the source says only "Next.js".

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
**Decision.** The extractor returns experience as the CV lays it out: per employer the company and its line, the positions with their own lines, and the bullets with the index of their position or "the whole group". A deterministic function flattens this into the existing facts and assigns every id; a position's company is checked in the group line when that line is one source line before the position with nothing of another company in between. The writer, the judge, "Not in your CV" and the document schema are unchanged. Owner's decision, 2026-10-29 (task R0-EXTRACT-NESTED).

## 028. No cascade: achievements outlive a dropped position

**Context.** An achievement whose position was dropped (its quote not found) used to be dropped too, so one mis-copied title line silently removed a job and all its bullets.
**Decision.** Such an achievement goes to the first kept position of its group, else to the nearest kept position above it in the source (never across a section heading), else it stays without a position and is listed under "Not used". The judge still checks the placement (`moved_between_jobs`): the dropped position's line reaches it among the unrecognized lines. Until the judge knows company groups (decision 032), a bullet placed in its group under a position that is not the nearest one above it is usually rejected and becomes a question: it fails closed. Owner's decision, 2026-10-29 (task R0-NO-CASCADE).

## 029. PDF text follows the page layout

**Context.** PDF.js returns text in content-stream order. Two-column CVs came out with the sidebar and the main column interleaved by the generator's paint order, page 2 sub-headings far from their bullets, a header band at the end, and a right-hand column of dates after the bullets it belongs to; the extractor then quoted lines that do not belong together, and dates fell out of their position's quote.
**Options.** Keep the stream order · a one-gutter split of the whole page (failed on a full-width header and on a date column) · bands and gutters with a side-column rule · an external layout engine (a new dependency, larger attack surface in the worker).
**Decision.** Rows by baseline; a gutter is an empty vertical strip crossed by the fewest rows (never more than a tenth); rows that cross it cut the page into bands; a band is a short table or a marker list, a narrow side column in short blocks attached to its entry lines, or two columns read one after the other. A page without a gutter, or one too large for a CV, keeps the stream order, so simple PDFs read as before. Chosen by its effect on the whole dev corpus (no CV got worse); tables, scans and more than two columns are out of scope. Owner's task R0-PDF, 2026-10-29.
