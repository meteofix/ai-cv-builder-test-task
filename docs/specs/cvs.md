# CVs — create, list, read, edit, delete, questions

**Area:** `apps/api/src/cvs/` (routes, questions), `apps/api/src/sources/` (PDF text extraction), tests `apps/api/test/cvs.*`, `apps/api/test/sources.*`, fixtures in `apps/api/test/cvs/fixtures/`. **Builds on (main, frozen at S0):** `OwnedCvs.findOwned`, `GenerationQueue`, `ApiError` in `apps/api/src/common/`; the entities in `apps/api/src/db/`; `ROUTES`, `cvs.ts`, `questions.ts`, `LIMITS` in `@cv/shared`. Decisions: [005](../DECISIONS.md#005-pdf-text-extraction-in-a-worker-thread-text-only-storage), [011](../DECISIONS.md#011-one-cv-document-with-optimistic-locking-read-only-editor-during-ai-jobs), [017](../DECISIONS.md#017-ownership-enforced-in-data-access), [023](../DECISIONS.md#023-template-questions-and-targeted-answers).

## Goal

A signed-in user creates a CV from pasted text or a PDF plus a target role and gets an answer at once while generation runs in the background; lists and opens their CVs from any device; edits the document without overwriting a newer version; answers or dismisses questions; deletes a CV. Nobody else can reach their CVs.

## Contracts

| Route (`ROUTES.*`)                                           | Success                     | Errors (besides 400, 401, 404 `CV_NOT_FOUND`)                                                     |
| ------------------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------- |
| `createCvFromText` `POST /api/cvs`                           | 202 `{cvId, job}`           | 429 `GENERATION_LIMIT_REACHED`                                                                    |
| `createCvFromPdf` `POST /api/cvs/from-pdf` (multipart)       | 202 `{cvId, job}`           | 413 `PDF_TOO_LARGE`; 422 `PDF_INVALID`, `PDF_NO_TEXT`, `PDF_ENCRYPTED`, `PDF_TOO_MANY_PAGES`; 429 |
| `listCvs` `GET /api/cvs`                                     | 200 `{items: CvListItem[]}` | —                                                                                                 |
| `getCv` `GET /api/cvs/:id`                                   | 200 `CvDetail`              | —                                                                                                 |
| `updateDocument` `PUT /api/cvs/:id/document`                 | 200 `{document, version}`   | 409 `JOB_ACTIVE`, `DOCUMENT_NOT_READY`, `VERSION_CONFLICT`                                        |
| `deleteCv` `DELETE /api/cvs/:id`                             | 204                         | —                                                                                                 |
| `answerQuestion` `POST /api/cvs/:id/questions/:qid/answer`   | 202 `{question, job}`       | 404 `QUESTION_NOT_FOUND`; 409 `QUESTION_CLOSED`, `JOB_ACTIVE`                                     |
| `dismissQuestion` `POST /api/cvs/:id/questions/:qid/dismiss` | 200 `{question}`            | 404 `QUESTION_NOT_FOUND`; 409 `QUESTION_CLOSED`                                                   |

`GET /api/cvs/:id/job`, `POST /api/cvs/:id/job/retry`, `GET /api/cvs/:id/draft` and `GET /api/cvs/:id/not-in-cv` belong to the generation module ([generation.md](generation.md)); `GET /api/cvs/:id/pdf` to [pdf.md](pdf.md).

## Behaviour

### Creating a CV

1. **From text.** Validate `createCvFromTextRequestSchema` (role 1–200 characters, text 1–50 000, both trimmed). In one transaction: insert `cvs` (`document = null`, `version = 0`), `cv_sources` (`kind = 'text'`, the trimmed text) and call `GenerationQueue.enqueue(tx, cv, { kind: 'generate' })`. Answer 202 `{cvId, job}`. When the queue refuses (429 `GENERATION_LIMIT_REACHED`), the transaction rolls back and no CV exists.
2. **From PDF.** Read the multipart parts in any order: exactly one file part `file` and the field `targetRole` (`createCvFromPdfFieldsSchema`). Checks, in this order, each ending the request without creating anything:
   - the file is larger than `MAX_UPLOAD_BYTES` (10 MiB) → 413 `PDF_TOO_LARGE` (the multipart limit truncates the stream; treat a truncated file or Fastify's file-too-large error as this code, not as the generic `PAYLOAD_TOO_LARGE`);
   - `targetRole` is missing or invalid → 400 `VALIDATION_FAILED`;
   - the bytes do not start with `%PDF-` (the file name and the declared content type are ignored) → 422 `PDF_INVALID`;
   - extraction runs in a `worker_threads` worker with a 10 s timeout and `resourceLimits` (`maxOldGenerationSizeMb: 256`); a timeout, a crash or a parse error → 422 `PDF_INVALID`; a password-protected file → 422 `PDF_ENCRYPTED`; more than `LIMITS.maxPdfPages` (10) pages → 422 `PDF_TOO_MANY_PAGES` (checked before reading the text);
   - the extracted text (pages joined with `\n`, trimmed) contains no letter (`\p{L}`) → 422 `PDF_NO_TEXT` with a detail that says the file looks scanned and suggests pasting the text;
   - the text is longer than `LIMITS.maxSourceChars` → 400 `VALIDATION_FAILED` with a detail that says so.
     Then the same transaction as for text, with `kind = 'pdf'`. The PDF bytes are never written to disk or to the database; only the text is kept. Text extraction uses `unpdf`.

### Reading

3. **List.** The user's CVs, newest `updatedAt` first, no pagination. `fullName` is `document.contacts.fullName` or `null` when there is no document or the name is empty. `openQuestions` counts questions with status `open`. `state` comes from the document and the latest job:
   - latest job `generate` and `queued`/`running` → `generating`;
   - latest job `generate`, `failed`, and no document → `failed`;
   - latest job `apply_answer` and `queued`/`running` → `updating`;
   - otherwise `ready` when there is a document, else `generating`.
     The list is built with a fixed number of queries, not one per CV.
4. **Detail.** `CvDetail` with `job = GenerationQueue.getLatestJob(cv.id)` and all questions of the CV (any status) ordered by `createdAt`, then `id`. Dates are ISO 8601 strings with offset.

### Editing

5. **PUT document.** The body is validated by `updateDocumentRequestSchema` (the full document schema with its limits). Then, in this order: `findOwned` → an active job → 409 `JOB_ACTIVE` → no document yet → 409 `DOCUMENT_NOT_READY` → store with a compare-and-set on `version` (`... WHERE id = :id AND version = :version`); no row updated → 409 `VERSION_CONFLICT`. On success `version` grows by one and the answer is `{document, version}` as stored.
6. **Provenance on manual edits.** `factIds` and `factId` are server-owned; what the client sends for them is ignored. For every item the server compares with the stored document, by `id`:
   - a bullet or an `additional` item whose `text` is unchanged keeps its stored `factIds`; a changed or new one gets `[]`;
   - `summary` keeps its stored `factIds` only when `summary.text` is unchanged;
   - a position keeps its `factId` only when `company`, `title`, `location`, `start`, `end` and `current` are unchanged; an education entry when `institution`, `degree`, `start` and `end` are unchanged; a skill when `name` is unchanged; otherwise the field is removed.
     This is how the generation module tells user-written bullets (`factIds: []`) from AI-written ones.
7. **Delete.** `findOwned`, then delete the row; the source, questions and jobs go with it (`ON DELETE CASCADE`). Allowed while a job runs: the worker's fenced writes then match no row and it stops (see generation.md). 204.

### Questions

8. **Answer.** Validate `answerQuestionRequestSchema`, then: `findOwned` → the question must belong to this CV, else 404 `QUESTION_NOT_FOUND` (also for a malformed `qid`) → it must be `open`, else 409 `QUESTION_CLOSED` → `answer.type` must equal the question's `answerType`, else 400 `VALIDATION_FAILED`. In one transaction: set `status = 'answered'`, `answer`, `applyStatus = 'applying'`, `applyNote = null`, and `GenerationQueue.enqueue(tx, cv, { kind: 'apply_answer', target: { questionId, section, itemId }, payload: { questionId, answer } })` with `section` and `itemId` from the question's target. An active job makes the queue throw 409 `JOB_ACTIVE`, the transaction rolls back and the question stays open: answers are applied one at a time. 202 `{question, job}`.
9. **Dismiss.** Same lookups and `QUESTION_CLOSED` rule; set `status = 'dismissed'`; 200 `{question}`. Allowed while a job runs (it does not touch the document).

### Ownership

10. Every handler with `:id` calls `findOwned(id, user.id)` before anything else; questions are looked up only by `(qid, cv.id)` of the owned CV. A foreign, missing or malformed id is 404 `CV_NOT_FOUND`, the same body as a missing one. The main copy's `apps/api/test/ownership.e2e-spec.ts` checks every route with `:id` of `ROUTES` from a second account with a valid body; a new route needs a valid body there (ask the user, the file is main's).

## Acceptance examples

Test files `apps/api/test/cvs.acceptance.spec.ts` (and `sources.acceptance.spec.ts` for extraction if split); each test name starts with the example id. Users and sessions come from `signIn()`; CVs, jobs and questions for read/edit cases from the factories in `apps/api/test/support/`. "The sample text" is `SAMPLE_SOURCE_TEXT`.

- **CVS-1 — create from text answers at once.** `POST /api/cvs {"targetRole":"Senior Backend Engineer","text":"  <sample text>  "}` → 202 `{"cvId":<uuid>,"job":{"id":<uuid>,"kind":"generate","status":"queued","step":null}}`. `GET /api/cvs/<cvId>` → `document: null`, `version: 0`, `job` equal to the one returned, `questions: []`; `cv_sources` has `kind: 'text'` and the trimmed sample text.
- **CVS-2 — create from a PDF keeps only the text.** A one-page PDF printed by Chromium from HTML with the sample text, uploaded with `targetRole=Senior Backend Engineer` → 202; `cv_sources.kind` is `pdf` and its text contains `Iryna Kovalenko` and `Acme Corp`.
- **CVS-3 — bad files are refused with a clear code and create nothing.** Each upload below, with a valid `targetRole`, gives the status and code shown, and the user has no CVs afterwards:
  | file                                                                             | result                   |
  | -------------------------------------------------------------------------------- | ------------------------ |
  | empty file                                                                       | 422 `PDF_INVALID`        |
  | PNG bytes sent as `cv.pdf`, `application/pdf`                                    | 422 `PDF_INVALID`        |
  | `%PDF-1.7` followed by garbage                                                   | 422 `PDF_INVALID`        |
  | a PDF whose only content is an image of text (printed from HTML with an `<img>`) | 422 `PDF_NO_TEXT`        |
  | a password-protected PDF (committed fixture)                                     | 422 `PDF_ENCRYPTED`      |
  | a PDF with 11 pages                                                              | 422 `PDF_TOO_MANY_PAGES` |
  | 10 MiB + 1 byte starting with `%PDF-`                                            | 413 `PDF_TOO_LARGE`      |
- **CVS-4 — the role is required for uploads too.** A valid text PDF without `targetRole` → 400 `VALIDATION_FAILED`; no CV.
- **CVS-5 — the list shows only the user's CVs and their state.** User A has four CVs, user B one. A's list has exactly A's four, newest `updatedAt` first, with:
  | A's CV                                                                                           | expected item                                                       |
  | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
  | no document, generate job `running`                                                              | `state: "generating"`, `fullName: null`, `openQuestions: 0`         |
  | no document, generate job `failed`                                                               | `state: "failed"`                                                   |
  | document with `fullName` "Iryna Kovalenko", generate `succeeded`, questions: 2 open, 1 dismissed | `state: "ready"`, `fullName: "Iryna Kovalenko"`, `openQuestions: 2` |
  | document, apply_answer job `queued`                                                              | `state: "updating"`                                                 |
- **CVS-6 — saving a document.** A CV with a document at `version: 1`; `PUT .../document` with a changed headline and `version: 1` → 200 with that headline and `version: 2`; `GET` shows `version: 2`.
- **CVS-7 — a stale save does not overwrite.** Same CV after CVS-6; `PUT` with `version: 1` → 409 `VERSION_CONFLICT`; the stored document and `version: 2` are unchanged.
- **CVS-8 — no edits while AI works.** A CV with a document and a job in `queued`, and another in `running` → `PUT` with the current version → 409 `JOB_ACTIVE` for both.
- **CVS-9 — no edits before the first generation.** A CV without a document → `PUT` with a valid document and `version: 0` → 409 `DOCUMENT_NOT_READY`.
- **CVS-10 — manual edits drop provenance.** Stored: bullet `b1` "Led the migration of billing to TypeScript." with `factIds: ["f3"]`, bullet `b2` with `factIds: ["f4"]`, summary with `factIds: ["f1"]`, position `p1` with `factId: "f2"`. `PUT` with `b1` text changed, `b2` unchanged but sent with `factIds: []`, a new bullet `b3` sent with `factIds: ["f9"]`, the summary text changed and `p1.company` changed → stored: `b1.factIds = []`, `b2.factIds = ["f4"]`, `b3.factIds = []`, `summary.factIds = []`, `p1` has no `factId`.
- **CVS-11 — delete.** `DELETE /api/cvs/:id` → 204; `GET` → 404 `CV_NOT_FOUND`; no `cv_sources`, `cv_questions` or `generation_jobs` rows of it remain. Deleting a CV whose job is `running` → 204 as well.
- **CVS-12 — answering a question queues a targeted job.** A CV with a document and an open `dates` question targeting `{section: "experience", itemId: "p1", field: "dates"}`; `POST .../answer {"answer":{"type":"dates","start":"2021-03","end":null,"current":true}}` → 202; `question.status = "answered"`, `question.applyStatus = "applying"`, `question.answer` as sent; `job = {kind: "apply_answer", status: "queued", step: null, target: {questionId, section: "experience", itemId: "p1"}}`. Answering it again → 409 `QUESTION_CLOSED`. Answering a second open question while that job is queued → 409 `JOB_ACTIVE`, and the second question is still `open`.
- **CVS-13 — wrong answers.** A `text` answer to a `dates` question → 400 `VALIDATION_FAILED`; a `qid` of another CV of the same user → 404 `QUESTION_NOT_FOUND`.
- **CVS-14 — dismiss.** An open question → `POST .../dismiss` → 200 with `status: "dismissed"`; again → 409 `QUESTION_CLOSED`; dismissing works while a job is `running`.
- **CVS-15 — the daily limit stops creation without a trace.** With `GENERATIONS_PER_USER_PER_DAY=1`, the second `POST /api/cvs` → 429 `GENERATION_LIMIT_REACHED`; the user has one CV.
- **CVS-16 — ownership.** From a second account, every route of this spec with `:id` → 404 `CV_NOT_FOUND` (`apps/api/test/ownership.e2e-spec.ts`, main; it must pass with these routes registered).

## Definition of done

The acceptance examples pass; the ownership test passes with all routes of this spec registered; the route table test passes; `pnpm check` is green; Swagger lists the routes; this spec matches the code; fixtures have a short `fixtures/README.md` saying how each file was made.

## Required tests

The acceptance examples, plus: a PDF whose extraction hangs (or a worker that exceeds the timeout) is 422 `PDF_INVALID` within about 10 s; the detail never echoes the CV text; `GET /api/cvs` makes the same number of queries for 1 and 5 CVs (or uses one query per concern by construction).
