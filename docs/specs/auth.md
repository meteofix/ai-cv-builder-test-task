# Auth — sign-up, login, logout, current user

**Area:** `apps/api/src/auth/`, tests `apps/api/test/auth.*`. **Builds on (main, frozen at S0):** the global session guard, `@Public()`, `@CurrentUser()` and `session-token.ts` in `apps/api/src/common/`; `ROUTES.signup|login|logout|me`, `credentialsSchema` and `userSchema` in `@cv/shared`; the `users` and `sessions` tables. Decisions: [016](../DECISIONS.md#016-server-side-sessions-in-postgres), [018](../DECISIONS.md#018-defense-in-depth-with-framework-built-ins).

## Goal

A user signs up and logs in with email and password and stays signed in for 30 days on every device they use. Logout really ends the session. The only secret of the deployment stays `ANTHROPIC_API_KEY`.

## Contracts

| Route                   | Body                | Success                    | Errors                                                         |
| ----------------------- | ------------------- | -------------------------- | -------------------------------------------------------------- |
| `POST /api/auth/signup` | `{email, password}` | 201 `{id, email}` + cookie | 400 `VALIDATION_FAILED`, 409 `EMAIL_TAKEN`, 429 `RATE_LIMITED` |
| `POST /api/auth/login`  | `{email, password}` | 200 `{id, email}` + cookie | 400, 401 `INVALID_CREDENTIALS`, 429 `RATE_LIMITED`             |
| `POST /api/auth/logout` | —                   | 204, cookie cleared        | 401 `UNAUTHENTICATED`                                          |
| `GET /api/auth/me`      | —                   | 200 `{id, email}`          | 401 `UNAUTHENTICATED`                                          |

- `credentialsSchema`: the email is trimmed and lower-cased before validation (at most 254 characters); the password has 8–128 characters.
- Cookie `sid`: the value from `newSessionToken()`, options from `sessionCookieOptions(config)` — `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` = `SESSION_TTL_DAYS` × 86 400, `Secure` only when `COOKIE_SECURE=true`. It is set with `HttpAdapterHost.httpAdapter.setCookie()` and cleared with `clearCookie()` with the same `path`.
- A `sessions` row stores `hashSessionToken(token)` and `expiresAt = sessionExpiry(config)`; the token itself is never stored or logged.
- `signup` and `login` are `@Public()`; `logout` and `me` need a session (the global guard).

## Behaviour

1. **Sign-up.** Validate the body; if the normalized email exists, answer 409 `EMAIL_TAKEN`. Hash the password with argon2id (`argon2.hash`, library defaults), insert the user and a session in one transaction, set the cookie, answer 201. The unique index on `users.email` is the final check: a violation from a parallel sign-up is also 409 `EMAIL_TAKEN`.
2. **Login.** Look the user up by the normalized email. When there is no such user, still run `argon2.verify` against a fixed dummy hash, so both failures take the same time; both answer the same 401 `INVALID_CREDENTIALS` with the same body apart from `requestId`. On success insert a new session and set the cookie; other sessions of the user stay valid (other devices).
3. **Logout.** Delete the current session row (`SessionUser.sessionId`) and clear the cookie; 204. A request with the old cookie is then 401.
4. **Current user.** `GET /api/auth/me` returns `{id, email}` of the session's user.
5. **Rate limit.** `ThrottlerGuard` on signup and login only: `AUTH_RATE_LIMIT_PER_MINUTE` requests per client address per minute (default 10); the address comes from `X-Forwarded-For` of a trusted proxy (`trustProxy`, already wired). Over the limit: 429 `RATE_LIMITED`.
6. **CSRF.** Every `POST` here is covered by the global `enableCsrfProtection()`: a cross-site request is 403 `FORBIDDEN` before the handler runs.
7. **Logging.** Log the user id and the outcome; never the email, the password, the token or its hash.
8. **Swagger.** The four routes appear in `/api/docs` with their schemas (time box: 30 minutes; if `@Body({ schema })` does not show up by itself, describe the routes with `@ApiBody`/`@ApiResponse` and stop there).

## Acceptance examples

Test file `apps/api/test/auth.acceptance.spec.ts`; each test name starts with the example id. Requests go through `inject()` with `sec-fetch-site: same-origin`.

- **AUTH-1 — sign-up signs the user in.** `POST /api/auth/signup {"email":"Iryna@Example.com","password":"correct horse"}` → 201, body `{"id":<uuid>,"email":"iryna@example.com"}`, `Set-Cookie` with `sid=`, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=2592000` and without `Secure`. `GET /api/auth/me` with that cookie → 200 with the same body.
- **AUTH-2 — one account per email, any case.** After AUTH-1, `POST /api/auth/signup {"email":" iryna@example.com ","password":"another pass"}` → 409, `code: "EMAIL_TAKEN"`.
- **AUTH-3 — the two login failures look the same.** For an existing user, login with a wrong password and login with an unknown email both → 401 `INVALID_CREDENTIALS`; the two bodies are equal after removing `requestId`.
- **AUTH-4 — login from a second device.** Sign up, then log in with the same credentials → 200 and a new cookie; `GET /api/auth/me` works with both cookies.
- **AUTH-5 — logout revokes the session on the server.** Sign up, `POST /api/auth/logout` with the cookie → 204 and a `Set-Cookie` that clears `sid`; `GET /api/auth/me` with the old cookie → 401 `UNAUTHENTICATED`.
- **AUTH-6 — the password is stored as argon2id.** After sign-up, `users.password_hash` starts with `$argon2id$` and does not contain the password.
- **AUTH-7 — invalid input.** `POST /api/auth/signup {"email":"iryna@example.com","password":"short"}` → 400 `VALIDATION_FAILED` with an `errors` entry whose `path` is `password`; `{"email":"not-an-email","password":"correct horse"}` → 400 with `path` `email`.
- **AUTH-8 — login rate limit per client address.** With `AUTH_RATE_LIMIT_PER_MINUTE=3`, four failed logins from `X-Forwarded-For: 203.0.113.9` via a private `remoteAddress` → the fourth is 429 `RATE_LIMITED`; a login from `203.0.113.10` right after is not 429.
- **AUTH-9 — Secure cookie behind TLS.** With `COOKIE_SECURE=true`, the sign-up cookie has `Secure`.

## Definition of done

The acceptance examples pass; `pnpm check` is green; the routes match `ROUTES` (the route table test passes); nothing in the code logs an email, password, token or hash; this spec matches the code.

## Required tests

The acceptance examples above, plus: an expired session (`expiresAt` in the past) is 401 on `me`; a parallel double sign-up with one email ends with exactly one user (one 201, one 409).
