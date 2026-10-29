import { expectedBullets } from './expected.js';
import { ratio, type ExtractionMetrics } from './extraction-metrics.js';
import type { FullMetrics } from './full-metrics.js';
import type { CallRecord } from './eval-llm.js';
import type { PositionMatch } from './position-match.js';

const seconds = (ms: number) => (ms / 1000).toFixed(1);

function row(cells: readonly (string | number)[]): string {
  return `| ${cells.join(' | ')} |`;
}

function table(header: readonly string[], rows: readonly (string | number)[][]): string {
  return [row(header), row(header.map(() => '---')), ...rows.map(row)].join('\n');
}

function positionCounts(matches: readonly PositionMatch[]) {
  const count = (test: (match: PositionMatch) => boolean) => matches.filter(test).length;
  return {
    found: count((match) => match.found !== null),
    company: count((match) => match.companyOk),
    complete: count((match) => match.companyOk && match.titleOk && match.datesOk),
  };
}

function counters(record: Record<string, number>): string {
  const entries = Object.entries(record).filter(([, count]) => count > 0);
  return entries.length === 0 ? '0' : entries.map(([name, count]) => `${name} ${count}`).join(', ');
}

export interface ExtractionRow {
  name: string;
  metrics: ExtractionMetrics;
  textMs: number;
  calls: CallRecord[];
}

export function extractionTable(rows: readonly ExtractionRow[]): string {
  return table(
    [
      'file',
      'kept',
      'dropped',
      'moved / unplaced',
      'content lines',
      'not recognized',
      'positions found / exp.',
      'with company',
      'company+title+dates',
      'achievements / exp.',
      'skills / exp.',
      'edu',
      'other',
      'draft questions',
      'calls',
      'extractor s',
      'tokens in/out',
    ],
    rows.map(({ name, metrics, calls }) => {
      const expected = metrics.expected;
      const positions = positionCounts(metrics.matches);
      const of = (found: number, total: number | undefined) =>
        total === undefined ? `${found}` : `${found}/${total} (${ratio(found, total)})`;
      return [
        name,
        metrics.kept,
        counters(metrics.dropped),
        `${metrics.placed.reattached} / ${metrics.placed.unplaced}`,
        metrics.contentLines,
        `${metrics.uncovered} (${ratio(metrics.uncovered, metrics.contentLines)})`,
        of(metrics.positions.length, expected?.positions.length),
        expected ? `${positions.company}/${expected.positions.length}` : '—',
        expected ? `${positions.complete}/${expected.positions.length}` : '—',
        of(metrics.achievements, expected ? expectedBullets(expected) : undefined),
        of(metrics.skills, expected?.skills),
        metrics.education,
        metrics.other,
        counters(metrics.questions),
        calls.length,
        seconds(calls.reduce((sum, call) => sum + call.latencyMs, 0)),
        `${sum(calls, 'inputTokens')}/${sum(calls, 'outputTokens')}`,
      ];
    }),
  );
}

function sum(calls: readonly CallRecord[], field: 'inputTokens' | 'outputTokens'): number {
  return calls.reduce((total, call) => total + call[field], 0);
}

/** Expected positions one by one: what was found for each. */
export function positionDetails(name: string, matches: readonly PositionMatch[]): string {
  if (matches.length === 0) return '';
  const lines = matches.map(({ expected, found, companyOk, titleOk, datesOk }) => {
    const flags = [
      found ? 'found' : 'MISSING',
      companyOk ? '' : 'company✗',
      titleOk ? '' : 'title✗',
      datesOk
        ? ''
        : `dates✗ (${found?.start ?? '?'}–${found?.end ?? (found?.current ? 'now' : '?')})`,
    ].filter(Boolean);
    const bullets = found ? `${found.bullets}/${expected.bullets}` : `–/${expected.bullets}`;
    return `- ${expected.title || '(no title)'} @ ${expected.company}${expected.group ? ` [${expected.group}]` : ''}: ${flags.join(' ')}; bullets ${bullets}`;
  });
  return [`**${name}**`, ...lines].join('\n');
}

export interface FullRow {
  name: string;
  metrics: FullMetrics;
  contentLines: number;
  steps: Record<string, number>;
  totalMs: number;
}

export function fullTable(rows: readonly FullRow[]): string {
  return table(
    [
      'file',
      'company+title+dates',
      'company questions',
      'source order',
      'achievements doc+unused / exp.',
      'skills doc+unused / exp.',
      'not recognized / content lines',
      "couldn't verify",
      'questions',
      'queued s',
      'extract s',
      'write s',
      'judge s',
      'finalize s',
      'total s',
    ],
    rows.map(({ name, metrics, contentLines, steps, totalMs }) => {
      const expected = metrics.expected;
      const positions = positionCounts(metrics.matches);
      const bulletTotal = expected ? expectedBullets(expected) : 0;
      return [
        name,
        expected ? `${positions.complete}/${expected.positions.length}` : '—',
        metrics.questions.company ?? 0,
        metrics.sourceOrder === null ? 'n/a (no draft)' : metrics.sourceOrder ? 'yes' : 'NO',
        `${metrics.bullets}/${bulletTotal} (${ratio(metrics.bullets, bulletTotal)})`,
        metrics.skills === null
          ? 'n/a (no draft)'
          : expected
            ? `${metrics.skills}/${expected.skills} (${ratio(metrics.skills, expected.skills)})`
            : `${metrics.skills}`,
        `${metrics.notRecognized}/${contentLines} (${ratio(metrics.notRecognized, contentLines)})`,
        metrics.unverified.length,
        counters(metrics.questions),
        seconds(steps.queued ?? 0),
        seconds(steps.extract ?? 0),
        seconds(steps.write ?? 0),
        seconds(steps.judge ?? 0),
        seconds(steps.finalize ?? 0),
        seconds(totalMs),
      ];
    }),
  );
}
