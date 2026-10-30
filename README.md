# AI CV Builder

Turns a PDF CV or free text into an editable CV adapted to a target role, plus an A4 PDF. The model, as the author, writes the CV; a separate call, as the reviewer, checks it against the source; and code guards what can be checked deterministically: contacts, references to the source, and accounting for everything the CV leaves out. Missing details become questions for the user. The task's required flow works end to end.

![The editor: the form on the left, the A4 preview on the right](docs/screenshots/editor-desktop.png)

## Run it

You need Docker with Compose and an Anthropic API key.

```sh
cp .env.example .env
```

Set `ANTHROPIC_API_KEY` in `.env`.

```sh
docker compose up --build
```

The app runs at http://localhost:8080 (from a phone on the same network, `http://<your-computer-ip>:8080`); the first build takes a few minutes. Simple fictional CVs to try (including ones with gaps and with a hidden injection) are in `examples/`. A quick path through the whole flow: sign up, paste `examples/sample-cv-gaps.txt` with the role "Senior Product Designer", reload the page during generation, answer a question, edit a field and download the PDF. The API is documented at http://localhost:8080/api/docs.

**Tests** (Node 24):

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm playwright:install
ANTHROPIC_API_KEY=test-placeholder docker compose up -d postgres
pnpm check
```

The tests run against real Postgres and Chromium. The model is replaced by a scripted fake, so tests incur no API costs and every run is reproducible. The task's requirements and failure cases mapped to tests: [`docs/verification.md`](docs/verification.md).

## Stack

- **Backend:** NestJS on Fastify, MikroORM, PostgreSQL, zod.
- **Frontend:** React, Vite, TanStack Query, Tailwind, behind nginx.
- **AI:** Claude Opus 5.5.
- **PDF:** Chromium driven by Playwright.
- **Tests:** Vitest.

All in TypeScript, a pnpm monorepo with two apps (`apps/api`, `apps/web`) and two shared packages:

- `packages/shared` — shared zod contracts (the CV schema, the API, error codes) for the backend, the frontend and Swagger, so they cannot drift apart.
- `packages/cv-template` — the CV template, one for the preview and the PDF.

## How I used AI tools: building with agents

Claude Code agents (Opus 5.5 and Sonnet 5.5, mostly at effort high) wrote all of the code, and Codex (GPT-6-Astra, effort high) was the second reviewer, from another vendor. My part was the architectural and product decisions, checking the work, and changing course when the data showed an approach was wrong.

**Specs first, then code.** I started with a brainstorm in Claude Desktop; the same session later advised me during implementation, with read-only access to the project. The brainstorm covered the task and the criteria, then resolved the open decisions one at a time, each with 2–3 options. It produced 7 specs with acceptance examples (`docs/specs/`) and an ADR for every decision. Before any code was written, I found 4 defects in the specs that the agents' reviews had missed.

**The harness is in the repo.** Rules live in `AGENTS.md`; `.claude/` holds three subagents (commit reviewer, mutation check, spec judge), the `/commit` skill that runs lint, types, tests and the reviewer before every commit, and hooks that block dangerous commands, pushes and `.env` reads, keep each parallel worktree in its own files and stop an agent from finishing with broken types. The guards are tested in `scripts/lib/`.

**Autonomous work behind merge gates.** At night, on its own and by rules set in advance, an orchestrator agent ran three parallel streams (auth, generation, web) in separate git worktrees: it handed out tasks, settled some questions itself, left the critical ones for the morning, and merged a stream only after a full `pnpm check`, a mutation check (break the code on purpose; does a test fail?) and a Codex review. The agents ran without permission prompts, so the rules in `AGENTS.md` say when they really must stop and ask me.

**Two reviewers from two vendors.** A Claude subagent reviewed every commit; Codex reviewed the worktree branches before they were merged into main, in normal and adversarial mode. Critical findings blocked the merge.

**Real data broke the first version.** Tests and reviews were green, but on my own CV a position, the strongest achievements and part of the structure disappeared. The reviews had checked that the code matched the spec, not whether the spec was right. Too much determinism in my brief turned out to be the wrong call: rigid rules lost content. So instead of patching the first version I rebuilt the system around an author and a reviewer, and the code got smaller.

**Measuring quality.** The corpus mixes public templates, invented layouts, free text and real CVs (with permission, kept local). I wrote the free-text inputs outside the session that builds the system, so they were not shaped by the agent whose work they test. Expectations were written before a run; after each stage the corpus was rerun against the previous version, and the holdout was opened once. Opus was judging text written by Opus, so I added a second judge, Sonnet. An A/A test measured the noise; without it I would have rejected a variant over a chance loss. I chose the models by one rule: quality is a constraint, and among the variants that are not worse, the fastest wins.

**The final checks** again found what the tests had not:

- new non-technical CVs: 4 systematic defects;
- the final audits (code cleanliness, failures, README honesty, architecture): answers could bypass the daily limit;
- a clean clone and an iPhone: the editor crashing over plain HTTP, and zoom on form fields.

All of it was fixed in code.

**What I decided:**

- the stack and the architecture;
- the key decisions in the specs;
- rebuilding the architecture instead of patching it;
- soft targets instead of hard limits;
- how to measure: a realistic role for each CV, two judges, subtle planted inventions;
- the choice of models, based on the evals;
- what to leave out of this scope on purpose;
- when to trust the metrics and when to trust a manual review of the generated PDFs.

## How the AI is kept from inventing facts

Code checks what can be checked deterministically, a model judges meaning, and the rest becomes a question.

1. **Segments.** The source is split into numbered lines. Lines that look like instructions are cut before any model sees them; this is only the first layer. The rest reaches the models as data inside tags.
2. **The author** rewrites, condenses and groups items for the role and cites the source lines behind each one. An item that is already good is kept as it is, and then the server, not the model, copies its text from the source.
3. **Code checks deterministically:** email, phone and links come only from the source; every item must cite real lines; dates must have the right format. Every model answer passes schema validation.
4. **The reviewer** checks the whole CV against the source and returns only problems: `fix` is corrected text, `ask` takes the item out and turns it into a question.
5. **Accounting:** source content that did not make it into the CV is shown in "Not in your CV" with a reason, and can be put back with "Add" (except instruction lines and cases where a limit is reached). Whether a rewritten item keeps every fact in the line it cites is the reviewer's call: measured by the evals, not guaranteed by code.
6. **Questions and answers.** A content answer rewrites only the part of the CV the question is about, and the reviewer checks it again.

## Adapting to the role

The summary is written for the target role, groups of items and skills are reordered so the relevant ones come first, and the questions follow from the role; the system does not invent experience to fit it. Positions stay newest first; an older one moves up only when it is clearly more relevant, and the editor shows why. Less relevant content is shortened, but the bar is deliberately high ("when unsure, keep it"): losing content is worse than keeping extra, and whatever is removed is shown with a reason. So for FinOps Manager and Farm Owner, one CV from the corpus only had its summary and skills reworked (for FinOps, with questions about AWS billing), while for Barista it shrank to 1–2 bullets per position (only what carries over to the new role) and from 3 pages to 2, with 17 removed items in "Not in your CV". The adaptation goes by the role's name; tailoring to a specific job description is out of the task's scope.

## Architecture

**The generation pipeline:**

source → numbered lines (code) → author (Opus, effort medium) → reviewer (Opus, effort low) → code: contacts, accounting, questions → CV

The author writes the whole CV in one call and cites the source lines behind each item. The reviewer checks the CV against the source for unsupported claims, inflated roles or scope, and items under the wrong position. It does not judge style, order or relevance. Effort low is enough for it: checking is a narrower task than writing, and in the evals low is no worse than medium.

**Main decisions:**

- **Generation is a background job in a Postgres table**, not a request that waits for an answer. A job is claimed under a lease with fencing, and every step's result is stored. Reloading the page loses nothing, and a restarted API resumes at the first unfinished step. No separate broker: the queue lives in the same transaction as the data.
- **Access.** A global guard requires a session everywhere except sign-up, login, health and Swagger. The data layer separately checks the CV's owner: a foreign CV is a 404. A test runs every CV route as another user. Sessions are server-side, so logout really revokes them.
- **A CV is one JSON document**, not tables of positions and bullets: the same shape goes from the model to the editor and the template, and a version number keeps two tabs from overwriting each other.
- **The server renders the PDF** in Chromium from the same template as the preview. The result is real text and looks the same on any device.

Details and alternatives: [`docs/architecture.md`](docs/architecture.md), [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Failures and untrusted input

- **Model output** passes schema validation on every answer. A failure gets one re-ask, within a budget of up to 15 calls per generation.
- **Anthropic API errors.** A transient error is retried with increasing delays (honouring `retry-after`); if that does not help, the job goes back to the queue with longer pauses and finally ends with a clear message and a Retry button. A permanent error (such as a rejected key) ends the job at once, also with a message.
- **Application errors** go through one filter: a `problem+json` response with a stable code and a `requestId`; the web app turns the code into a clear message. An unexpected render error shows a message, not a blank screen.
- **Uploads:** the file must really be a PDF within the size and page limits; its text is read in a separate thread with limits. A scanned or encrypted file gets a clear message.
- **Accounts and input:** passwords are hashed with argon2, sign-up and login are rate-limited, the session cookie is httpOnly and SameSite=Lax, and every request body passes the shared zod contracts with size limits.
- **A daily limit:** generations, text answers and retries all count against it, so API spend is bounded.

The full table of cases with their tests: [`docs/verification.md`](docs/verification.md).

## Evals

The corpus: 11 CVs for development, 5 free texts and two holdout sets (6 and 4 inputs, mostly real CVs, some of them non-technical). In a blind pairwise comparison with two judges (Opus and Sonnet), the current pipeline beat the first version: on development, 9 wins, 0 losses and 2 cases without a unanimous verdict; on free text, 5 of 5. The reviewer flagged 76 of 76 planted inventions, with 4 false alarms on 131 clean items. On 17 inputs, median generation time and cost were 24 s and $0.10, not counting the upload, the queue and the PDF. The holdouts found 5 defects, all fixed in code. Details, models and how to rerun: [`docs/evals.md`](docs/evals.md).

## Trade-offs

| Decision                                                         | Why                                                                                                    | What it costs                                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| A Vite SPA behind nginx, not Next.js                             | Everything sits behind a login, so server rendering adds nothing; one origin serves the app and `/api` | No SSR, which this app does not need                                                         |
| A Postgres queue inside the API process                          | No new infrastructure, transactional with the data                                                     | One process; under load, a separate worker                                                   |
| Progress by polling, no streaming                                | Simple, and survives a reload                                                                          | The user sees steps, not text appearing                                                      |
| Opus as the author                                               | Sonnet, and Opus at effort low, performed worse: they cut bullets short and dropped details            | A generation took 16–63 s in the evals                                                       |
| Prompt-injection defence: English patterns for instruction lines | A simple first layer; then the rule "the CV is data" in both prompts, schemas, contacts in code        | A disguised injection is held back only by the rule in the prompts                           |
| A high relevance bar                                             | Losing content is worse than keeping extra                                                             | CVs for adjacent roles are barely shortened; a dense two-page CV can come out at three pages |
| One document version; a stale save gets 409                      | Two tabs cannot overwrite each other                                                                   | Changes are not merged: the tab shows the latest saved version                               |

## What was cut and what comes next

Cut for time: UI/UX polish (most of all the "Not in your CV" panel), streaming sections and faster generation. The evals measure generation; answers to questions are covered by tests of the mechanics, without an eval of their quality. Known reliability gaps, found by the final audit and left for later: the web app has no request timeouts, a finished job can replace unsaved edits, and some limits cut silently (a long direct answer, questions past 10).

**What I would do differently:** put real CVs into the corpus before writing the specs, not after the first version was built.

**AI quality**

- More precise shortening of irrelevant content, and a warning when the role is far from the CV.
- Answers that change the structure, and an eval of answers: new experience in an answer ("2 years as a barista") should become a position, not just a line in the summary.
- A deeper injection defence (a separate classifier model).

**Product and UX**

- "Not in your CV": show where an item will go, show the result of "Add", hide lines that have already been answered.
- Skills as tags, a paged preview, a preview on the CV list page, several versions of one CV for different roles, and more.

**Speed and scale**

- Streaming sections during generation and a parallel author per section. The goal: noticeably faster with no loss of quality.
- A separate worker; cost accounting in tokens instead of a count of starts.

Known limitations and technical debt: [`docs/architecture.md`](docs/architecture.md).

## Screenshots

| Generation                                                 | Questions                                            |
| ---------------------------------------------------------- | ---------------------------------------------------- |
| ![Generation steps](docs/screenshots/progress-desktop.png) | ![Questions](docs/screenshots/questions-desktop.png) |
| **The editor on a phone**                                  | **The PDF**                                          |
| ![The editor at 360 px](docs/screenshots/editor-phone.png) | ![The PDF](docs/screenshots/pdf-desktop.png)         |
