# AI CV Builder

A web app that turns a PDF or pasted text into a structured, editable CV and a PDF. An LLM (the author) writes the text from the source, citing the source lines; a second LLM call (the reviewer) checks the whole CV against the source; code keeps the contracts, the exact contacts and the accounting of what the CV leaves out. Faithfulness rests on the reviewer and is measured by evals, not proven by code.

Rules for coding agents. Nested `AGENTS.md` files (`apps/api`, `apps/web`, `packages/cv-template`) add package rules. There is no `CLAUDE.md` or `CLAUDE.local.md` in this repository on purpose: Claude Code reads `AGENTS.md` only when no `CLAUDE.md` exists, so never add one. Decisions and their reasons are in `docs/DECISIONS.md`; module behaviour is in `docs/specs/`.

## Stack (versions are pinned in `pnpm-workspace.yaml`)

Node 24, pnpm 12.15, TypeScript 6.0 (7.x does not work with Nest CLI 12 yet), ESM everywhere. API: NestJS 12.3 on Fastify 5, MikroORM 7.2, PostgreSQL 17, zod 4, Anthropic SDK 1.3, pino, Playwright 1.64 (PDF). Web: React 19, Vite 8, Tailwind 4, TanStack Query 5, react-hook-form, MSW. Tests: Vitest 5.

APIs of these versions are newer than most training data. Check the docs of the exact version before using one (the `context7` plugin, or the sites below) and do not rely on memory:
NestJS https://docs.nestjs.com · MikroORM https://mikro-orm.io/docs · zod https://zod.dev · Playwright https://playwright.dev · Anthropic https://docs.claude.com · pnpm https://pnpm.io.

## Structure

```
apps/api              NestJS API and the in-process job worker
apps/web              React single-page app (nginx in production)
packages/shared       zod schemas and contracts shared by api, web and template
packages/cv-template  React template of the CV: the preview and the PDF use the same HTML
docs/                 DECISIONS.md (why), specs/ (what each module does), design/ (reference template)
scripts/              worktree:init, zone:check and the logic behind the hooks
```

## Commands

```
pnpm install --frozen-lockfile     first step in a fresh clone
pnpm playwright:install            Chromium headless shell for the PDF and template tests (once)
ANTHROPIC_API_KEY=test-placeholder docker compose up -d postgres
                                   the one Postgres: dev data and tests (port 5432, localhost only; Compose needs the key set for any service)
pnpm check                         build packages + lint + typecheck + all tests; must be green
pnpm lint | typecheck | test       the parts of check (typecheck builds the packages first)
pnpm --filter @cv/api test         one package; add a file name to run one file
docker compose up                  the whole app on http://localhost:8080 (needs ANTHROPIC_API_KEY in .env)
```

API tests need Postgres: without it they stop with one message that names the command to run. PDF and template tests need Chromium: if it is missing, run `pnpm playwright:install`. A linked git worktree must be set up first with `pnpm worktree:init <auth|pipeline|web>`: it writes `.env` and `.claude/settings.local.json`, installs dependencies and builds the packages. Until then hooks block edits and the API and tests refuse to start.

## Rules

- TypeScript strict, no `any`, no `console.log` (use the pino logger), no `@ts-ignore`. Imports in `apps/api` and `packages/*` end with `.js`.
- Output of an LLM is untrusted input. Consume it only through a zod schema (`messages.parse`, or `safeParse` on a tool input); never `JSON.parse` a model answer.
- **Hallucination guard.** Code checks only what is mechanically checkable (cited segment ids, kept text, contacts, dates, limits, the accounting of source lines); the reviewer model assesses meaning; everything else becomes a visible question to the user. Do not add heuristics, lexicons or capitalization rules to the code: they produce false positives on clean input.
- Every access to a CV goes through `findOwned(id, userId)`; a foreign or missing id is a 404. New routes get a case in the ownership table test.
- No secrets and no personal data (CV text, facts, prompts, emails, tokens) in logs or error messages. Never read `.env` files; `.env.example` lists the variables. The hooks and the deny rule that enforce this are a best-effort backstop, not a guarantee: do not look for ways around them.
- Handle an error where you can do something about it; let everything else reach the global exception filter. No defensive `try/catch`, no swallowed errors.
- Comments explain why, not what. Files stay under about 300 lines; split by responsibility. No dead code, no unused dependencies.
- New dependencies, changes to shared contracts, configs, compose files, Dockerfiles, migrations and specs outside your area need the user's permission (see below). Code you write for a task stays inside the area the task belongs to; `pnpm zone:check` verifies it.

## Tests

- Write the acceptance tests first, from the "Acceptance examples" of the module's spec (`*.acceptance.spec.ts`, spec referenced in the test name). A committed acceptance test, or the "Acceptance examples" section of a spec, changes only with a `spec-judge` verdict named in the commit message (`/spec-dispute`).
- API tests run against real Postgres and a scripted fake LLM; PDF and template tests use real Chromium. Browser-level tests use MSW. No test calls the real Anthropic API; live calls happen only through the eval CLI, run by hand.
- Table-driven cases use `test.each`. No `.only` or `.skip` (ESLint fails on them). A test must fail if the code it protects is broken: when unsure, break the code and see.
- Unit tests sit next to the code (`*.test.ts`); API integration tests are `apps/api/test/<module>.e2e-spec.ts`.

## Definition of done

A task is done when `pnpm check` is green, the module's spec matches the code, the acceptance tests exist and pass, and the commit went through `/commit`.

## Commits

Conventional Commits in English, one commit per task (`type(scope): subject`, imperative, at most 72 characters). Every task commit ends with a trailer paragraph: `Task: <id>` next to `Co-Authored-By`; `/commit` adds it. A fix after review carries the trailer of the task it fixes. Never push, never force, never change `main` from a worktree.

## When to ask a human

Stop and ask only when: (1) a change is needed in an area only the user changes — shared contracts, dependencies, migrations, configs, compose; (2) spec-judge returned "the spec is ambiguous"; (3) you disagree with a BLOCKING finding from the reviewer or Codex; (4) the branch is ready to merge; (5) a change is needed on the machine outside the repository that no script of this repository performs — installing or removing system software (brew, global npm or pnpm packages), changing configs in the home directory (`~/.docker`, `~/.zshrc` and the like), stopping or starting third-party services. Commands defined in the repository (`pnpm playwright:install`, `pnpm worktree:init`, `docker compose` with this repository's compose file) need no question. A hidden dependency on something installed globally breaks the start on a reviewer's clean machine, so if the repository cannot run without such a change, ask for it to be made inside the repository instead. Decide everything else yourself and record it as a `decision` line in the local AI log (`AI_LOG.md`, not committed).

## Reviewer checklist

The `reviewer` agent and any external review use this list: correctness and concurrency (job leases and fencing, single-flight autosave, version conflicts); security (owner-scoped access, validated input, no secrets in logs, upload limits, session and CSRF); error handling (global filter, problem+json codes as specified); LLM output only through schemas, the author's output checked by the reviewer, source text passed to models only as data; behaviour matches the spec and every acceptance example has a test; tests would fail if the code were broken; the rules above. Findings come as BLOCKING, SHOULD-FIX and NITS.

All review outputs (the reviewer, Codex, spec-judge verdicts, mutation checks, plugin passes) are saved verbatim under `.reviews/` with a status under each finding (fixed with a commit / deferred to <where> / not a problem because <why>); the chat gets only the path and the counts per level. A finding is never dismissed without an explanation.
