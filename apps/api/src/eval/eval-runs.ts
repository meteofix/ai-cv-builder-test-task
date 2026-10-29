import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cvDocumentSchema } from '@cv/shared';
import type { AppConfig } from '../config/env.js';
import { authorOutputSchema } from '../generation/compose/author-schema.js';
import { prepareSource, reviewRequest } from '../generation/compose/compose.js';
import { buildDraft } from '../generation/compose/draft.js';
import { reviewView } from '../generation/compose/review.js';
import { callCost } from './compose-eval.js';
import { evalClient } from './eval-llm.js';
import { comparePair } from './pairwise.js';
import { plant, score } from './reviewer-test.js';

/** One corpus input as the comparing modes read it: its name, its source text and its target role. */
export interface EvalInput {
  name: string;
  text: string;
  role: string;
}

/** Every input judged blind against two earlier dumps; a markdown report. */
export async function runPairwise(
  config: AppConfig,
  inputs: readonly EvalInput[],
  first: string,
  second: string,
): Promise<string> {
  const { client, calls } = evalClient(config);
  const documentIn = async (dir: string, file: EvalInput) =>
    cvDocumentSchema.parse(
      JSON.parse(await readFile(join(dir, `${file.name}.document.json`), 'utf8')),
    );
  const rows: string[] = [];
  const details: string[] = [];
  const results = await Promise.all(
    inputs.map(async (file) => {
      const { role } = file;
      const result = await comparePair(client.parse.bind(client), {
        source: file.text,
        role,
        first: await documentIn(first, file),
        second: await documentIn(second, file),
      });
      return { file, result };
    }),
  );
  for (const { file, result } of results) {
    const o = result.outcome;
    rows.push(
      `| ${file.name} | ${o.overall} | ${o.completeness} | ${o.structure} | ${o.rewriting} | ${o.faithfulness} | ${o.relevantKept} | ${result.inventedFirst.length} | ${result.inventedSecond.length} |`,
    );
    details.push(`**${file.name}**`, ...result.notes.map((note) => `- ${note}`));
    details.push(...result.inventedFirst.map((claim) => `  - first: ${claim}`));
    details.push(...result.inventedSecond.map((claim) => `  - second: ${claim}`));
  }
  const cost = calls.reduce((sum, call) => sum + callCost(call), 0);
  return [
    `## Pairwise: second (${second}) against first (${first}); outcome for the second`,
    '',
    '| file | overall | completeness | structure | rewriting | faithfulness | relevant kept | unsupported in first | unsupported in second |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    ...details,
    '',
    `Judge calls: ${calls.length}, $${cost.toFixed(2)}`,
  ].join('\n');
}

/** The reviewer on every stored author answer, untouched and with planted inventions; a markdown report. */
export async function runReviewerTest(
  config: AppConfig,
  inputs: readonly EvalInput[],
  first: string,
): Promise<string> {
  const { client, calls } = evalClient(config);
  const job = { id: 'eval', lockedBy: 'eval' };
  const signal = new AbortController().signal;
  const rows: string[] = [];
  const findings: string[] = [];
  const totals = { planted: 0, caught: 0, items: 0, falseAlarms: 0 };
  const results = await Promise.all(
    inputs.map(async (file) => {
      const { role } = file;
      const source = prepareSource(file.text);
      const author = authorOutputSchema.parse(
        JSON.parse(await readFile(join(first, `${file.name}.author.json`), 'utf8')),
      );
      const { answer, planted } = plant(author, source);
      const review = (input: typeof author) =>
        client.parse({ ...reviewRequest(source, input, role), job, signal });
      const [clean, dirty] = await Promise.all([review(author), review(answer)]);
      const items = reviewView(buildDraft(author, source.index, source.text, role)).targets.size;
      return { file, planted, clean, dirty, items };
    }),
  );
  for (const { file, planted, clean, dirty, items } of results) {
    const scored = score(dirty, planted);
    totals.planted += planted.length;
    totals.caught += scored.caught.length;
    totals.items += items;
    totals.falseAlarms += clean.issues.length;
    rows.push(
      `| ${file.name} | ${planted.map((p) => p.kind).join(', ')} | ${scored.caught.join(', ') || '—'} | ${scored.missed.join(', ') || '—'} | ${clean.issues.length} / ${items} | ${scored.others.length} |`,
    );
    for (const issue of clean.issues) {
      findings.push(
        `- ${file.name} clean ${issue.item} ${issue.action} ${issue.class}: ${issue.text ?? ''} ${issue.question ?? ''}`,
      );
    }
    for (const issue of dirty.issues) {
      findings.push(
        `- ${file.name} planted ${issue.item} ${issue.action} ${issue.class}: ${issue.text ?? ''} ${issue.question ?? ''}`,
      );
    }
  }
  const cost = calls.reduce((sum, call) => sum + callCost(call), 0);
  return [
    `## Reviewer test (${config.REVIEWER_MODEL}/${config.REVIEWER_EFFORT}) on ${first}`,
    '',
    `Recall: ${totals.caught}/${totals.planted}. False alarms on the clean answers: ${totals.falseAlarms} findings over ${totals.items} items.`,
    '',
    '| file | planted | caught | missed | clean: findings / items | planted run: other findings |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    ...findings,
    '',
    `Reviewer calls: ${calls.length}, $${cost.toFixed(2)}`,
  ].join('\n');
}
