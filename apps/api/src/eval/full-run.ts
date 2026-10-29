import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  createCvResponseSchema,
  cvDetailSchema,
  draftResponseSchema,
  jobSchema,
  notInCvResponseSchema,
  ROUTES,
  routePath,
  type CvDetail,
  type CvDocument,
  type NotInCvItem,
} from '@cv/shared';
import type { z } from 'zod';

const POLL_MS = 250;
const RUN_TIMEOUT_MS = 6 * 60_000;

export interface FullRun {
  /** Milliseconds per step, from polling the job: the time the job spent with that step as current. */
  steps: Record<string, number>;
  totalMs: number;
  /** The staged draft (all kept facts, source order), captured while the writer ran. */
  draft: CvDocument | null;
  detail: CvDetail;
  notInCv: NotInCvItem[];
}

/**
 * A signed-in client of a running app (`docker compose up`), the way the browser talks to it. Every
 * session signs up a new `eval-<uuid>@example.com` user in that app's database and leaves it there.
 */
export class ApiSession {
  private constructor(
    private readonly baseUrl: string,
    private readonly cookie: string,
  ) {}

  /** A fresh user per session keeps the per-user daily generation limit out of the way. */
  static async signUp(baseUrl: string): Promise<ApiSession> {
    const response = await fetch(new URL(ROUTES.signup.path, baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ email: `eval-${randomUUID()}@example.com`, password: randomUUID() }),
    });
    if (!response.ok) throw new Error(`Sign-up failed: ${await problemOf(response)}`);
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    return new ApiSession(baseUrl, cookie);
  }

  async request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('cookie', this.cookie);
    headers.set('sec-fetch-site', 'same-origin');
    const response = await fetch(new URL(path, this.baseUrl), { ...init, headers });
    if (!response.ok)
      throw new Error(`${init.method ?? 'GET'} ${path} answered ${response.status}`);
    return schema.parse(await response.json());
  }

  /** Creates the CV, waits for its generation and collects what the editor would show. */
  async generate(source: { pdf: Uint8Array } | { text: string }, targetRole: string) {
    const started = performance.now();
    const created =
      'pdf' in source
        ? await this.request(ROUTES.createCvFromPdf.path, createCvResponseSchema, {
            method: 'POST',
            body: pdfForm(source.pdf, targetRole),
          })
        : await this.request(ROUTES.createCvFromText.path, createCvResponseSchema, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: source.text, targetRole }),
          });
    const id = created.cvId;
    const steps: Record<string, number> = {};
    let current = { step: created.job.step ?? 'queued', since: performance.now() };
    let draft: CvDocument | null = null;
    for (;;) {
      if (performance.now() - started > RUN_TIMEOUT_MS) throw new Error('Generation timed out');
      const job = await this.request(routePath(ROUTES.getJob.path, { id }), jobSchema);
      const step = job.step ?? 'queued';
      if (step !== current.step) {
        steps[current.step] = (steps[current.step] ?? 0) + performance.now() - current.since;
        current = { step, since: performance.now() };
      }
      if (draft === null && job.status === 'running' && step !== 'extract') {
        draft = (await this.request(routePath(ROUTES.getDraft.path, { id }), draftResponseSchema))
          .draft;
      }
      if (job.status === 'failed') throw new Error(`Generation failed: ${job.error?.code}`);
      if (job.status === 'succeeded') break;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    steps[current.step] = (steps[current.step] ?? 0) + performance.now() - current.since;
    const detail = await this.request(routePath(ROUTES.getCv.path, { id }), cvDetailSchema);
    const notInCv = await this.request(
      routePath(ROUTES.getNotInCv.path, { id }),
      notInCvResponseSchema,
    );
    return {
      steps,
      totalMs: performance.now() - started,
      draft,
      detail,
      notInCv: notInCv.items,
    } satisfies FullRun;
  }
}

/** The status and the stable `code` of an error answer (RFC 9457); its detail stays out of the output. */
async function problemOf(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  const code =
    body !== null && typeof body === 'object' && 'code' in body ? String(body.code) : 'no code';
  return `${response.status} ${code}`;
}

function pdfForm(pdf: Uint8Array, targetRole: string): FormData {
  const form = new FormData();
  form.set('targetRole', targetRole);
  form.set('file', new Blob([pdf], { type: 'application/pdf' }), 'cv.pdf');
  return form;
}
