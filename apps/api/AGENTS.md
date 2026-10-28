# apps/api

NestJS 12 on Fastify 5, MikroORM 7 on PostgreSQL 17. Read the root `AGENTS.md` first.

## Layout

`src/<module>/` per module: `config`, `db`, `common`, `auth`, `cvs`, `sources`, `generation`, `grounding`, `llm`, `pdf`, `health`. All modules are already registered in `AppModule`; a module adds its own controllers and providers in its own `*.module.ts`.

- `config/` — env schema (`env.ts`, fails fast with the missing key), logger, worktree detection. `AppConfig` and the root pino logger are injected with `APP_CONFIG` and `ROOT_LOGGER`.
- `bootstrap.ts` — every global mechanism: `trustProxy`, request ids, CSRF (`enableCsrfProtection`), security headers, `StandardSchemaValidationPipe`, Swagger at `/api/docs`. `main.ts` adds `enableShutdownHooks()`. Tests build the app with the same `createApp`.
- `db/` — entities (`defineEntity`), the migrations (listed in `migrations/index.ts`) and `ensureDatabase()`, which creates a missing database and applies pending migrations for both startup and the test setup. Foreign keys to `cvs` cascade on delete. Schema changes are main-only: a new migration is generated against a migrated database and added to the list.
- `common/` — shared building blocks (session guard, `@Public()`, `@CurrentUser()`, `findOwned`, `GenerationQueue`).
- `grounding` and `@cv/shared` are pure TypeScript; the Anthropic SDK is imported only in `llm/`, behind the `LlmClient` port.

## Conventions

- Request bodies are validated with zod schemas from `@cv/shared`: `@Body({ schema })`. The same schemas feed Swagger.
- Errors are `application/problem+json` with a stable `code` and `requestId` (the global filter owns the shape).
- JSON is camelCase, ids are UUIDs, times ISO 8601. A job is queued with 202; logout and delete answer 204.
- Controllers stay thin; logic lives in services. No generation work inside an HTTP request: it runs as a job.
- Code that edits a CV document goes through the document's zod schema and the `version` check.

## Tests

- `src/**/*.test.ts` — unit tests, no database. `test/*.e2e-spec.ts` and `test/*.acceptance.spec.ts` — integration tests on the stream's test database (`cv_test`, or `cv_test_<stream>` in a worktree). The file name starts with the module name.
- `test/support/` — setup, `createTestApp()` and `inject()`, `signIn()` (a session row plus the cookie and same-origin headers CSRF needs), data factories (`createUser`, `createCv` with its source, `createJob`, `createQuestion`, `sampleDocument`) and `resetDatabase()` for `beforeEach`. Log in and create data through them, not through another module's endpoints.
- Requests go through Fastify `inject()`; the background worker is off in tests (`WORKER_ENABLED=false`) and driven with `processNext()`.
