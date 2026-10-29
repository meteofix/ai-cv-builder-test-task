# AI CV Builder

Turns a PDF or pasted text into a structured, editable CV for a target role, and a PDF with selectable text. One model call (the author) reads the whole source and writes the CV, citing the source lines behind every item; a second call (the reviewer) checks the whole CV against the source and fixes or takes out anything it does not support. Code keeps the contracts, the exact contacts and the accounting: nothing in the source disappears without showing in the CV or in "Not in your CV", and everything missing, vague or unsupported becomes a question to the user. English and Ukrainian CVs are supported; the CV keeps the language of the source.

![The editor on a desktop: form on the left, the live A4 preview on the right](docs/screenshots/editor-desktop.png)

## Run it

You need Docker with Compose and an Anthropic API key.

```sh
cp .env.example .env          # then set ANTHROPIC_API_KEY in .env
docker compose up --build     # http://localhost:8080
```

The first build takes a few minutes (the API image installs Chromium); the app is ready when the `api` healthcheck passes. Migrations run on startup. Without a key, `docker compose up` stops at once with "Set ANTHROPIC_API_KEY in .env". Sign up with any email and a password of 8+ characters; `examples/` has sample CVs to paste or upload. The layout works at 360 px (checked in an emulated phone browser); to open it from a phone on the same network use `http://<your-ip>:8080` — the session cookie is not `Secure` unless `COOKIE_SECURE=true`.

## Run the tests

Node 24 (`.nvmrc`) and pnpm 12 (`corepack enable`). From a fresh clone:

```sh
pnpm install --frozen-lockfile
pnpm playwright:install            # Chromium headless shell for the PDF and template tests (once)
cp .env.example .env               # Compose reads the key for every service; any placeholder works for tests
docker compose up -d postgres      # the tests use a cv_test database in this Postgres
pnpm check                         # lint, typecheck and every test
```

`pnpm --filter @cv/api test` (or `@cv/web`, `@cv/cv-template`, `@cv/shared`) runs one package; add a file name to run one file. Without Postgres or Chromium the tests stop with one message naming the command to run. No test calls the Anthropic API: the API tests replace the LLM transport with a scripted fake, so retries, the call budget and re-asks run the real code. CI (`.github/workflows/ci.yml`) runs the same `pnpm check`, then builds the app and the images.

## Architecture

```
Browser (React SPA) ── one origin ──► web: nginx ── /api ──► api: NestJS 12 on Fastify
                                                             ├ HTTP: auth · cvs · sources · questions · pdf · /api/docs
                                                             ├ job worker in the same process (Postgres table, SKIP LOCKED)
                                                             ├ llm → Anthropic: Opus writes (author) · Opus checks (reviewer)
                                                             └ pdf → Playwright Chromium (the same HTML as the preview)
                                                             ▼
                                                         PostgreSQL 17
```

pnpm monorepo, TypeScript strict, ESM:

- `apps/api` — NestJS + MikroORM. Modules: `auth` (email/password, server-side sessions), `cvs` (CRUD, versioned saves, ownership), `sources` (PDF text extraction in a worker thread), `generation` (job engine; `compose/` holds the steps as pure functions: segments → author → review → document, questions, "Not in your CV"), `grounding` (pure: source segments, instruction lines, contacts, skill lists), `llm` (the only place that talks to Anthropic), `pdf`.
- `apps/web` — React 19 SPA (Vite, TanStack Query, react-hook-form, Tailwind 4), served by nginx, which also proxies `/api`.
- `packages/shared` — zod schemas: the one CV document schema, request/response contracts, the route table, error codes and limits. The API validates with them, the web client parses responses with them, Swagger is generated from them (`/api/docs`).
- `packages/cv-template` — the CV as React markup and CSS. The preview and the PDF render the same HTML.

Main decisions (the full log with the alternatives is in [`docs/DECISIONS.md`](docs/DECISIONS.md); module behaviour in [`docs/specs/`](docs/specs/)):

- **Generation runs as a background job**, never inside an HTTP request. `POST /api/cvs` answers 202 at once; the job lives in a Postgres table claimed with `FOR UPDATE SKIP LOCKED`, under a 30 s lease with a heartbeat and fencing (every write of the worker checks it still holds the job). Each step's result is stored, so a restarted API resumes at the first unfinished step without repeating finished LLM calls. No Redis and no separate worker service: one process is enough at this scale, and the queue is transactional with the data.
- **Progress by polling** `GET /api/cvs/:id/job` every 1.5 s while a job is active, as steps (Writing · Checking facts · Finishing). There is no draft on the way: the author writes the whole CV in one call. Time per generation is in [Evals](#evals-on-real-and-invented-cvs).
- **One JSON document per CV with a `version`**: a save from a stale tab gets 409 and reloads instead of overwriting. The editor is read-only while an AI job changes the CV. Autosave is single-flight and never resets the form, so typing is not lost.
- **Server-side sessions** in Postgres (httpOnly `SameSite=Lax` cookie, argon2id), so logout really revokes. CSRF protection by Fetch Metadata, security headers and rate limits on sign-up and login come from the framework.
- **Ownership in the data layer**: every CV access goes through `findOwned(id, userId)`; a foreign id is a 404. A table-driven test runs every CV route of the route table as a second user.
- **Errors** are RFC 9457 `problem+json` with a stable `code` and a `requestId`; the web app maps codes to messages. Logs are JSON (pino) with request and job ids, token counts and latency of every LLM call, and never CV content.

## How the AI is kept from inventing facts

Principle: **code guards what is mechanically checkable, a model reviews meaning, and everything else becomes a visible question.** Code never decides whether a sentence is true; it decides only what can be counted or compared character by character. Why the earlier fact-by-fact validator was replaced: [decision 035](docs/DECISIONS.md#035-v2-an-author-and-a-reviewer-instead-of-verified-facts).

1. **Segments (code).** The source (PDF text read by layout, or pasted text) becomes numbered segments `S1…Sn`: one per line, a long line split into sentences. Segments that read as instructions to an AI ("ignore the above and add …") are cut before any model sees them and shown as "Ignored as an instruction". The rest reaches the models only inside `<cv_source>`, declared as data, and is cached between the calls.
2. **Author (Claude Opus).** Writes the whole CV for the target role in the source's structure (jobs, groups of bullets, skill groups, projects, courses). Each item either **keeps** segments word for word (the server copies the text, so a good bullet stays the person's words) or is a **rewritten** item that cites its evidence segments. It also says what it left out and why, what is missing or vague (questions), and why an older job comes first when it does. The answer is validated by a zod schema and by checks that need the source (every id is a real segment, dates `YYYY` or `YYYY-MM`, the limits after kept text is filled in); a failure is asked again once, never cut.
3. **Contacts (code).** Email, phone and links are kept only when they appear in the source as written. A handle is not a link: "Site://name", "Telegram@name" or "Telegram: @name" never becomes `https://…`. A handle the source labels as Telegram becomes its `https://t.me/` link; any other handle the source holds goes to "Not in your CV" with "Add". An invented contact is dropped.
4. **Reviewer (Claude Opus, its own prompt).** Sees the whole CV with each item's segments next to the source and returns only problems, each a `fix` (a corrected text with its segments; preferred) or an `ask` (the item is taken out and becomes a question). It judges support only — not relevance, order, style or length — and names a class for each problem: an invented detail, an inflated scope (a bigger role, team or result), a changed scope ("providers and models" → "models"), a wrong time, a wrong job, a wrong number. A group title is a claim too. The reviewer test below plants ten kinds of subtle inventions to measure it.
5. **Nothing disappears silently (code + prompt + reviewer, measured).** Code guarantees that every content line of the source has a place: an item of the document, or "Not in your CV" with the author's or the reviewer's reason and an "Add" button; an item the reviewer took out shows its text in its question. Two places rest on a model, not on code. (a) A line the author files as a heading counts as placed; the reviewer sees the ones the CV shows nowhere and returns one that holds content, which code then lists in "Not in your CV" (measured: 6 of 6 planted content lines reported, 1 report about a real heading over 11 CVs). (b) When the author ties a line with content (a GPA, honours, a thesis topic) to the header of a record — a school, a job, a project — the CV shows only that record's fields, so the line's visibility rests on a rule in the author's prompt. A mechanical check (does the line contain the header's name or a year?) was measured and rejected: 87 flags over 398 such lines, mostly false (names wrapped over two lines, a degree spelled differently, a line with a duration). The eval measures these cases instead: 0 on the corpus after the rule (up to 6 per run before it with the faster settings, about 1 with the chosen one). After an answer, every earlier AI item the rewritten part no longer shows word for word goes to "Not in your CV" as earlier wording, with "Add".
6. **Answers.** A dates answer is applied without a model. A text answer becomes a segment `A<n>`; the author rewrites only the part the question is about (the one item the review took out, put back in its place; or one group of a job; or the summary), the reviewer checks the new items, and nothing else in the CV changes. An earlier item the rewrite no longer shows word for word goes to "Not in your CV" as earlier wording.

All model output goes through zod schemas; a job makes at most 15 model calls (one re-ask per call).

What the tests prove and what they do not: the unit and acceptance tests run on a scripted model and prove the mechanics — kept text is copied exactly, an invented contact is dropped, an instruction line never reaches a model, a reviewer's `ask` takes the item out and asks, an answer changes only its part, an author answer over a limit is asked again, nothing leaves the CV without showing in the panel. How well the models write and review is measured by the evals below, not by the tests.

## Failures and untrusted input

"Run" means the scenario was run against the real stack (compose, real Anthropic API) on 2026-10-29; the tests named cover the same behaviour.

| Situation                                                                    | What happens                                                                                                                                                                                 | Checked by                                                                                             |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Page reloaded during a generation                                            | The same step; the job goes on.                                                                                                                                                              | Run: reloaded during `extract` and after the draft appeared. Web progress tests.                       |
| API killed during a generation (`docker compose kill api`, then `up -d api`) | After the 30 s lease another worker resumes the job at the first unfinished step; finished LLM calls are not repeated. A killed worker uses one of the 3 attempts; a graceful stop does not. | Run: killed during `extract`, and during `judge` (resumed with only the judge call). Job engine tests. |
| Anthropic 429 / 5xx / 529 / timeout                                          | Retried in the LLM client (honours `retry-after`), then the job is re-queued after 10 s and 30 s (3 attempts), then fails with a message and a Retry button.                                 | LLM client and generation tests.                                                                       |
| Invalid model output, call budget, refusal, rejected key                     | Re-asked with the validation error once per call; 15 calls per job; a refusal or a 401 is not retried; the job fails with its own message.                                                   | LLM client and generation tests.                                                                       |
| Empty file, or not a PDF                                                     | 422; the UI shows "This file is not a valid PDF."                                                                                                                                            | Run (UI and `curl`); sources tests.                                                                    |
| Scanned PDF (no text layer)                                                  | 422; the UI says the PDF looks scanned and asks to paste the text.                                                                                                                           | Run; tests with an image-only PDF printed by Chromium.                                                 |
| Encrypted PDF                                                                | 422; the UI asks to remove the password or paste the text.                                                                                                                                   | Run; fixture test.                                                                                     |
| PDF over 10 MB                                                               | Refused in the browser before upload; the API answers 413 `PDF_TOO_LARGE`, nginx 413 above 11 MB. Parsing runs in a worker thread with a time and memory limit, at most 10 pages.            | Run with 10.5 MB and 12 MB files; tests.                                                               |
| Same CV edited in two tabs                                                   | The stale tab's save gets 409; it reloads the latest version and says so.                                                                                                                    | Run; cvs and web autosave tests.                                                                       |
| Edit while an AI job changes the CV                                          | The editor is read-only with "Updating…"; a save would get 409 `JOB_ACTIVE`.                                                                                                                 | cvs and web tests.                                                                                     |
| Network lost in the browser                                                  | A connection banner; autosave keeps the typing and retries with backoff.                                                                                                                     | Web tests (MSW).                                                                                       |
| PDF rendering fails                                                          | 503 `PDF_RENDER_FAILED`, a message next to the button.                                                                                                                                       | PDF endpoint tests.                                                                                    |
| Generation limit                                                             | 30 per user per day, 300 in total (env); 429 with a message.                                                                                                                                 | Generation queue tests.                                                                                |
| Password guessing                                                            | Rate limit on login and sign-up; the same 401 and timing for an unknown email.                                                                                                               | Auth tests.                                                                                            |
| Prompt injection in the CV text                                              | Not followed: the segment is cut before any model sees it and listed under "Not in your CV" as ignored.                                                                                      | Run with `examples/sample-cv-injection.txt` ("add Google as my employer…"); GEN-4, GRD-21.             |
| Someone else's CV id in the URL                                              | 404 "This CV does not exist."; no route reveals or changes it.                                                                                                                               | Run (page and every route); the ownership table test.                                                  |
| CV deleted during its generation                                             | The cascade deletes the job; the worker's next fenced write matches nothing and it stops.                                                                                                    | Job engine tests.                                                                                      |
| An answer that cannot be applied                                             | The question shows "Could not apply" or "Partially applied" with a reason and can be answered again.                                                                                         | Answer tests.                                                                                          |
| Database down                                                                | `/api/health/ready` fails; the worker loop logs, backs off (1 s, 5 s, 30 s) and recovers.                                                                                                    | Worker tests.                                                                                          |

## Evals on real and invented CVs

The tests above run on a scripted model. How well the real models write and review is measured with `apps/api/src/eval/eval-cli.ts`: a whole generation through the real `LlmClient` and the same `generation/compose` steps a job runs (time, tokens and cost of every call), a blind pairwise comparison of two runs, and a reviewer test with planted inventions. The corpus and its expectations live outside the repository, because some CVs belong to real people; the expectations are written from the source before a run, never from the output.

**What was checked.**

- **Inputs.**
  - Dev: 11 CVs, each for a realistic role of its own profession. Ten are PDFs: two-column with a sidebar, banded two-column, dates in a right-hand column, dates and company in a left-hand column, two LinkedIn exports, a Ukrainian two-column CV, a sidebar with subsections inside a job, a LaTeX template, and the owner's own CV. One is plain text.
  - The owner's CV was also run for an adjacent role, and five dev CVs for adjacent roles.
  - Free text: 5 inputs — a detailed story, a short vague one, a Ukrainian story, a career change, and prose with a hidden instruction.
  - Two invented inputs were added late, with expectations written before their first run: eleven jobs over twenty years, and a student.
  - Holdout, run once at the end: 3 free-text inputs (notes, paragraphs without headings, a Ukrainian list plus a story) and 3 real CVs used with their owners' permission (a sidebar with subsections, a table with company and dates on the left, a sidebar with a group of positions).
- **Runs.**
  - The final configuration ran once on everything above, plus a second time on 6 key inputs.
  - Opus/medium ran at least three times on every dev CV across the trials.
- **Professions covered:** software, data, QA, design, localization, product, engineering management, support and marketing; English and Ukrainian.
- **Not covered:**
  - scanned PDFs (there is no OCR), three-column layouts, long tables;
  - languages other than English and Ukrainian, and DOCX;
  - a labelled set large enough for confidence intervals — the numbers below are counts on a small corpus, not rates.

**Results of the final configuration (author Opus/medium, reviewer Opus/low).**

- **Against `main` (the v1 pipeline).** Blind pairwise comparison by two judges (Opus and Sonnet), each in both orders. A win or a loss counts only when all four verdicts agree; anything else is a split.
  - Dev: 9 wins, 0 losses, 2 splits.
  - Free text: 5 wins out of 5.
  - The owner's CV: a win.
  - The second run on its inputs: 5 wins out of 5.
- **Reviewer test** (inventions planted into good answers in ten kinds: verb and role inflation, a dropped qualifier, a changed unit, a year moved by one, an added cause, a metric borrowed from another item, a team's result given to the person, a self-assessment, a changed scope): 76 of 76 found. On the untouched answers it raised 4 findings over 131 text items.
- **Inventions in the final documents:** none found by reading them.
  - What the judges still flag are roundings ("nearly 3 years" for a little less), totals of years counted from the dates (the prompt asks for whole years from the dates), and mild characterisations ("maintains" an open-source project the source lists as current).
  - Where a judge called a LinkedIn link altered, the source is a LinkedIn export that wraps the address over two lines, and the joined address is the right one.
- **Holdout** (one run):
  - every job has its company and dates on every CV, including the table layout, where `main` had lost one whole job and the dates of the others;
  - numbers and qualifiers are exact ("10+ language pairs", "~80 %");
  - links broken over two lines are joined;
  - the traps in the expectations were avoided ("worked with two squads" stays "worked with", "test design by the PMs").
  - It found one bug: messenger handles written without an address ("Telegram @name") became broken links. This was fixed after the run: a handle labelled as Telegram becomes its `t.me` link, any other handle goes to "Not in your CV". So for contacts the holdout is no longer independent; every other criterion is from the first run.
- **Second holdout** (4 more real CVs outside software — HR, product operations, design, product management; one run): it found links hidden under labels ("LinkedIn") in the PDF's link annotations, years of experience counted without the current date, a company description on the dates line counted as placed, and skill labels and names with a comma of their own split apart. All four were fixed after the run, so that holdout is no longer independent for these points.
- **Stability** (2 runs × 6 inputs):
  - the same jobs, bullets and pages;
  - one difference: a freelance job written once with "Freelance" as its company and once inside its title, which then asked for the company;
  - the time for the same input differs up to 2× (the model's reasoning varies).
- **Time and price per generation:**
  - median 24 s (16–63 s) and $0.10 (at most $0.24);
  - the owner's three-page CV takes 63 s.

**Model and effort: the trade-off** ([decision 039](docs/DECISIONS.md#039-v2-models-and-effort--opus-at-medium-writes-opus-at-low-reviews)).

- Quality is a hard condition: a setting must not be worse than Opus/medium in the pairwise comparison and the reviewer test, and must invent nothing. Among the settings that pass, the fastest is chosen.
- Because the models vary from run to run, the noise level comes from a second Opus/medium run judged against the first (A/A).
- In the table, "judge votes" counts the individual verdicts for and against.

| author + reviewer                           | dev median | the owner's CV | cost  | against Opus/medium on dev: agreed W/L/S, judge votes for/against | reviewer test: found, false alarms | what is lost                                          |
| ------------------------------------------- | ---------- | -------------- | ----- | ----------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------- |
| Opus/medium + Opus/medium, second run (A/A) | 25 s       | 63–77 s        | $0.09 | 0/1/10, 7/8 — the noise level                                     | 72/77, 4/130                       | —                                                     |
| **Opus/medium + Opus/low (chosen)**         | 25 s       | 63 s           | $0.10 | 0/2/9, 5/9 — within noise                                         | 76/76, 4/131                       | nothing measurable; saves about 1 s                   |
| Sonnet/high + Opus/low                      | 20 s       | 48 s           | $0.07 | 1/1/9, 4/12 — worse than noise                                    | —                                  | detail: lines hidden behind headers, fewer bullets    |
| Opus/low + Opus/medium                      | 20 s       | 32 s           | $0.07 | 0/1/10, 4/15 — worse than noise                                   | —                                  | detail: honours and a thesis, a "technical lead" line |
| Sonnet/medium + Opus/medium                 | 15 s       | 23 s           | $0.05 | 0/7/4 — clearly worse                                             | —                                  | bullets cut mid-sentence, a link cut short            |
| reviewer Sonnet                             | —          | —              | —     | —                                                                 | 74/78, 13/131                      | false alarms take true items out                      |

**Problems found on real CVs, and how they were solved.**

- **The rules of v1 lost content.**
  - A misquoted position took its bullets with it.
  - A company printed above three titles was erased.
  - Skill groups and projects were flattened.
  - About half of the judge's rejections were faithful rewrites.
  - Solution: v2 replaced the fact-by-fact validator with an author and a reviewer (decision 035).
- **Structure.**
  - Subsections inside a job and records of projects and courses were flattened. Every list became groups (decision 036).
  - One paragraph was split into a bullet and its continuation. The author's prompt now says one source item is one bullet.
  - Page 1 held only the header. The template now breaks inside a job, never right after a title.
  - A page that starts inside a job read as the previous job's bullets. It now starts with "<Company> — continued".
- **Layout artefacts of two-column PDFs.**
  - A label alone on a line ("Over 1000 lines:") became a skill.
  - A skill name wrapped over two lines was split in two. The author marks such a group as wrapped instead of retyping it.
  - A stylized handle ("Site://name", "Telegram: @name") became a broken link.
- **Wording.**
  - Compression removed the evidence of level ("from scratch", "self-initiated", "closed every finding"). The prompt keeps mechanism, scale and ownership.
  - The reviewer let "providers and models" become "models". It now has a class for a changed scope.
  - On a short CV the summary retold the bullets. The prompt asks for a shorter summary there; it is still a split against `main` on one CV.
- **Silent loss behind a header.** A school or a job could cite its GPA, honours or company description as one of its own lines, so the line counted as placed but showed nowhere. This is now a prompt rule, with the eval counting such lines (point 5 above).
- **An omitted optional field** in the author's answer used to need a re-ask, and once failed a generation. It is now read as empty.

## What I simplified, and what I would do with more time

Nothing in the task's scope was cut. Not built: showing the source lines of each bullet in the editor, a draft on screen while the author writes, a separate reader call that would read the structure before the author writes.

| Simplification                                                                                                                          | Why                                                                                     | Next                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Job queue in Postgres, worker in the API process                                                                                        | No new infrastructure; transactional with the data                                      | A separate worker process (same table), or a queue service at scale                                |
| Polling instead of SSE/WebSocket; no sections on screen while the author writes                                                         | Simple and survives reloads                                                             | Stream the CV's sections to the screen as the author writes them (perceived speed; ADR 039)        |
| Text-layer PDFs only, no OCR                                                                                                            | OCR is a project of its own                                                             | OCR for scans; for now a clear "paste the text" message                                            |
| PDF layout: up to two columns, a header band, a narrow date column; short tables                                                        | Covers the common CV layouts, measured on a corpus                                      | Long tables, three columns, rotated text and dates beside stacked titles are not laid out well yet |
| Questions are created once per generation; an answer rewrites only its own part                                                         | Predictable and cheap                                                                   | A conversational clarification mode                                                                |
| One template for screen and PDF                                                                                                         | Several templates are out of scope                                                      | More templates                                                                                     |
| Version column, a conflict reloads                                                                                                      | Two devices cannot silently overwrite each other                                        | Field-level merge                                                                                  |
| A simple daily generation limit                                                                                                         | Protects the API budget                                                                 | Per-plan limits, cost accounting                                                                   |
| Faithfulness rests on the reviewer, measured by evals, not proven by code                                                               | Code rules lost content on real CVs (decision 035)                                      | More planted kinds in the reviewer test; hints to the reviewer on numbers and names if it misses   |
| Length is a prompt rule; the page count is advice in the editor                                                                         | A "measure pages → shorten" loop costs a call and cuts text                             | The loop, if CVs still go past two pages                                                           |
| A company description (product type, scale) has no field of its own and goes to "Not in your CV"; "Add" puts it among the job's bullets | Nothing is lost silently; a new field changes the schema, the template and both prompts | A field under the company's header that the author writes and the reviewer checks                  |
| A company's shared bullets follow all its positions                                                                                     | Reads as the source does; no repeated bullets                                           | A structured ATS parser may attach them to the last position — a deliberate trade-off (ADR 038)    |
| An answer rewrites one group, the item or the summary                                                                                   | Predictable; nothing else in the CV moves                                               | An answer that restructures a job (a new subsection, a merge) — today a new generation             |
| No error tracker                                                                                                                        | Structured logs with request and job ids are enough locally                             | Sentry or similar                                                                                  |
| CI builds the images from scratch                                                                                                       | Simpler workflow                                                                        | Docker layer cache in CI                                                                           |
| Chromium sandbox disabled in the container                                                                                              | The API runs as a non-root user in its own container                                    | A dedicated rendering service                                                                      |

## How requirements are verified

Each requirement of the task, traced to tests (by reading their bodies, not their names) and to manual runs against the real stack. Test ids (AUTH-1, GEN-3, …) are the acceptance examples of [`docs/specs/`](docs/specs/). Paths: `api/test/` = `apps/api/test/`, `api/src/` = `apps/api/src/`, `web/` = `apps/web/src/`, `tpl/` = `packages/cv-template/test/`.

| Requirement                                                                                                                                  | Automated tests                                                                                                                                                                                                                                              | Run                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Sign up and log in with email and password                                                                                                   | `api/test/auth.acceptance.spec.ts` (AUTH-1…4), `web/auth.test.tsx`                                                                                                                                                                                           | sign-up; login from a second browser                          |
| A user sees and changes only their own CVs                                                                                                   | `api/test/ownership.e2e-spec.ts` (every CV route as a second user: 404, nothing changed), `api/test/cvs.acceptance.spec.ts` (CVS-5)                                                                                                                          | a foreign id in the URL                                       |
| PDF or free text plus a target role                                                                                                          | `api/test/cvs.acceptance.spec.ts` (CVS-1), `api/test/sources.acceptance.spec.ts` (CVS-2, CVS-4), `web/new-cv.test.tsx`                                                                                                                                       | text and PDF, desktop and phone                               |
| A draft with contacts, summary, experience, education, skills                                                                                | `api/test/generation.acceptance.spec.ts` (GEN-1), `api/src/generation/compose/compose.test.ts`                                                                                                                                                               | every sample in `examples/`                                   |
| Concise bullets, a summary for the role; the experience keeps the source order (owner's decision, ADR 033, instead of "most relevant first") | GEN-1 (the role reaches the author and the reviewer), `api/src/generation/compose/author-schema.test.ts` (limits, re-asked); length and order are the author prompt's (measured by the evals)                                                                | live runs (wording quality is the model's)                    |
| No frozen screen during generation                                                                                                           | `web/progress.test.tsx` (WEB-5), CVS-1 (202 at once)                                                                                                                                                                                                         | stepper                                                       |
| A reload does not lose the work                                                                                                              | `web/progress.test.tsx` (a reload shows the same step), GEN-19, `web/editor.test.tsx` (unsaved edits)                                                                                                                                                        | reload and API kill during a generation                       |
| The AI must not invent facts                                                                                                                 | GEN-3 (contacts only from the source), GEN-4 (instruction lines), GEN-6/7 (a reviewer's fix and ask), GEN-8 (no unchecked text), GEN-12 (nothing lost silently), `api/test/grounding.acceptance.spec.ts` (GRD-20…23); the model's behaviour: the evals below | the injection sample                                          |
| Missing or vague → a question; the answer updates its part                                                                                   | GEN-5, GEN-24, GEN-20…22 (dates without the LLM; only the asked group rewritten; partial), `api/test/generation.apply.e2e-spec.ts`, CVS-12, `web/questions.test.tsx`                                                                                         | dates and text answers                                        |
| Edit any field by hand                                                                                                                       | `web/editor.test.tsx` (every field; WEB-7 typing during a save; WEB-14 ↑/↓; WEB-16 removal), CVS-6, CVS-10                                                                                                                                                   | autosave, ↑/↓, removal with confirmation                      |
| A4 PDF with selectable text                                                                                                                  | `api/test/pdf.acceptance.spec.ts` (PDF-1: A4, extracted text, embedded font), `tpl/ats.acceptance.test.ts`, `tpl/ats-reading-order.test.ts`                                                                                                                  | download on desktop and phone                                 |
| Come back from any device                                                                                                                    | AUTH-4, CVS-5, `web/cv-list.test.tsx`                                                                                                                                                                                                                        | a second browser context                                      |
| Usable on a phone                                                                                                                            | `web/pdf-mobile.test.tsx` (phone layout)                                                                                                                                                                                                                     | the flow at 360 px in an emulated phone, no horizontal scroll |
| Node.js, REST, Anthropic for all LLM calls, Postgres                                                                                         | `api/test/app.e2e-spec.ts` (production entry point), `api/test/llm.acceptance.spec.ts` (the real SDK against a local fake server), every API test on Postgres 17                                                                                             | live runs                                                     |
| Runs with `docker compose up`; the only secret is the key                                                                                    | `api/src/config/env.test.ts` (fails fast, names the key)                                                                                                                                                                                                     | every run used compose                                        |

Not covered by a test: the quality of the model's wording, ordering and summary — measured by the evals (blind pairwise comparison and the reviewer test), not proven.

## Screenshots

|                                  | Desktop                                                                                  | Phone (360 px)                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Generation with the staged draft | ![Stepper and the draft preview, desktop](docs/screenshots/generation-draft-desktop.png) | ![Stepper and the draft preview, phone](docs/screenshots/generation-draft-phone.png) |
| Questions                        | ![Needs clarification block, desktop](docs/screenshots/questions-desktop.png)            | ![Needs clarification block, phone](docs/screenshots/questions-phone.png)            |
| Editor                           | ![Editor, desktop](docs/screenshots/editor-desktop.png)                                  | ![Experience card in the editor, phone](docs/screenshots/editor-phone.png)           |
| The PDF                          | ![The PDF in a viewer, desktop](docs/screenshots/pdf-desktop.png)                        | ![The PDF in a viewer, phone](docs/screenshots/pdf-phone.png)                        |

## How I used AI tools

TODO (user)

## Time spent

TODO (user)
