import { performance } from 'node:perf_hooks';
import type { AppConfig } from '../config/env.js';
import {
  authorRequest,
  compose,
  prepareSource,
  reviewRequest,
  type Composed,
  type ModelRequest,
} from '../generation/compose/compose.js';
import { JobError } from '../generation/job-errors.js';
import type { AuthorOutput } from '../generation/compose/author-schema.js';
import type { ReviewOutput } from '../generation/compose/review.js';
import { evalClient, type CallRecord } from './eval-llm.js';
import { expectedBullets, type Expected } from './expected.js';
import { matchPositions } from './position-match.js';

/** Prices per million tokens, for the report (input, output, cache read, cache write at 5 minutes). */
const PRICES: Record<string, [number, number, number, number]> = {
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-sonnet-5-5': [2, 10, 0.2, 2.5],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
};

export function callCost(call: CallRecord): number {
  const [input, output, read, write] = PRICES[call.model] ?? [0, 0, 0, 0];
  return (
    (call.inputTokens * input +
      call.outputTokens * output +
      call.cacheReadTokens * read +
      call.cacheWriteTokens * write) /
    1_000_000
  );
}

export type ComposeRun =
  | {
      ok: true;
      author: AuthorOutput;
      review: ReviewOutput;
      composed: Composed;
      calls: CallRecord[];
      problems: string[];
      totalMs: number;
    }
  | { ok: false; error: string; calls: CallRecord[]; problems: string[]; totalMs: number };

/** One generation as the job runs it (same requests, same client), without a database. */
export async function runCompose(
  config: AppConfig,
  text: string,
  targetRole: string,
): Promise<ComposeRun> {
  const { client, calls } = evalClient(config);
  const job = { id: 'eval', lockedBy: 'eval' };
  const signal = new AbortController().signal;
  const started = performance.now();
  const source = prepareSource(text);
  // Every refused answer, schema error or failed check, so the report says why a file was asked again.
  const problems: string[] = [];
  const recorded = <T>(request: ModelRequest<T>): ModelRequest<T> => ({
    ...request,
    check: (output) => {
      const problem = request.check(output);
      if (problem) problems.push(`${request.role}: ${problem}`);
      return problem;
    },
  });
  try {
    const author = await client.parse({
      ...recorded(authorRequest(source, targetRole)),
      job,
      signal,
    });
    const review = await client.parse({
      ...recorded(reviewRequest(source, author, targetRole)),
      job,
      signal,
    });
    const composed = compose(source, author, review, targetRole);
    return {
      ok: true,
      author,
      review,
      composed,
      calls,
      problems,
      totalMs: performance.now() - started,
    };
  } catch (error) {
    // A failed file is a result of the eval, like a failed job: it is reported and the run goes on.
    if (!(error instanceof JobError)) throw error;
    const totalMs = performance.now() - started;
    return { ok: false, error: error.message, calls, problems, totalMs };
  }
}

const pct = (part: number, whole: number) =>
  whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`;

/** One report row: structure against the expectation, what was kept, what the review did, time and cost. */
export function composeRow(name: string, run: ComposeRun, expected: Expected | null): string[] {
  if (!run.ok) return [name, `FAILED: ${run.error}`, ...COMPOSE_HEADER.slice(2).map(() => '')];
  const { document, questions, analysis, counts } = run.composed;
  const found = document.experience.map((job) => ({
    id: job.id,
    company: job.company,
    title: job.title,
    start: job.start,
    end: job.end,
    current: job.current,
    bullets: job.bullets.length,
  }));
  const matches = expected ? matchPositions(expected.positions, found) : [];
  const complete = matches.filter(
    (match) => match.companyOk && match.titleOk && match.datesOk,
  ).length;
  const bullets = document.experience.reduce((sum, job) => sum + job.bullets.length, 0);
  const extra = document.additional.reduce((sum, section) => sum + section.items.length, 0);
  const reasons = (reason: string) =>
    analysis.notInCv.filter((item) => item.reason === reason).length;
  const kinds: Record<string, number> = {};
  for (const question of questions) {
    const kind = question.kind === 'missing' ? (question.target.field ?? 'missing') : question.kind;
    kinds[kind] = (kinds[kind] ?? 0) + 1;
  }
  const byRole = (role: string) => run.calls.filter((call) => call.role === role);
  const seconds = (calls: readonly CallRecord[]) =>
    (calls.reduce((sum, call) => sum + call.latencyMs, 0) / 1000).toFixed(1);
  const cost = run.calls.reduce((sum, call) => sum + callCost(call), 0);
  const items = counts.kept + counts.rewritten;
  return [
    name,
    expected ? `${complete}/${expected.positions.length}` : `${document.experience.length}`,
    expected ? `${bullets}/${expectedBullets(expected)}` : `${bullets}`,
    expected ? `${document.skills.length}/${expected.skills}` : `${document.skills.length}`,
    expected
      ? `${document.education.length}/${expected.education}`
      : `${document.education.length}`,
    expected ? `${extra}/${expected.other}` : `${extra}`,
    `${counts.kept}/${items} (${pct(counts.kept, items)})`,
    `${counts.fixed} / ${counts.asked}`,
    `${reasons('not_included')} / ${reasons('not_placed')} / ${reasons('ignored')}`,
    Object.entries(kinds)
      .map(([kind, n]) => `${kind} ${n}`)
      .join(', ') || '0',
    analysis.orderReason ? 'yes' : '—',
    `${seconds(byRole('author'))} (${byRole('author').length})`,
    `${seconds(byRole('reviewer'))} (${byRole('reviewer').length})`,
    (run.totalMs / 1000).toFixed(1),
    `$${cost.toFixed(3)}`,
  ];
}

export const COMPOSE_HEADER = [
  'file',
  'jobs complete / exp.',
  'bullets / exp.',
  'skills / exp.',
  'edu / exp.',
  'extra / exp.',
  'kept items',
  'fix / ask',
  'not included / not placed / ignored',
  'questions',
  'order reason',
  'author s (calls)',
  'reviewer s (calls)',
  'total s',
  'cost',
];
