import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cvDocumentSchema } from '@cv/shared';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';
import { authorOutputSchema } from '../generation/compose/author-schema.js';
import { prepareSource, reviewRequest } from '../generation/compose/compose.js';
import { callCost } from './compose-eval.js';
import { evalClient } from './eval-llm.js';
import { agreed, comparePair, CRITERIA } from './pairwise.js';
import {
  applyPlants,
  candidates,
  PLANT_KINDS,
  PLANTER_SYSTEM,
  plantInput,
  plantsSchema,
  score,
  type PlantKind,
  type Planted,
} from './reviewer-test.js';

/** One corpus input as the comparing modes read it: its name, its source text and its target role. */
export interface EvalInput {
  name: string;
  text: string;
  role: string;
}

/** The two judges of the pairwise comparison (decision 036). */
export const PAIRWISE_JUDGES = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5' } as const;

/** Every input judged blind against two earlier dumps by both judges; a markdown report. */
export async function runPairwise(
  config: AppConfig,
  inputs: readonly EvalInput[],
  first: string,
  second: string,
): Promise<string> {
  const judges = Object.entries(PAIRWISE_JUDGES).map(([name, model]) => ({
    name,
    ...evalClient({ ...config, JUDGE_MODEL: model }),
  }));
  const documentIn = async (dir: string, file: EvalInput) =>
    cvDocumentSchema.parse(
      withGroups(JSON.parse(await readFile(join(dir, `${file.name}.document.json`), 'utf8'))),
    );
  const rows: string[] = [];
  const details: string[] = [];
  const results = await Promise.all(
    inputs.map(async (file) => {
      const pair = {
        source: file.text,
        role: file.role,
        first: await documentIn(first, file),
        second: await documentIn(second, file),
      };
      const byJudge = await Promise.all(
        judges.map((judge) => comparePair(judge.client.parse.bind(judge.client), pair)),
      );
      return { file, byJudge };
    }),
  );
  const totals: Record<string, number> = { win: 0, loss: 0, split: 0 };
  for (const { file, byJudge } of results) {
    const cell = (criterion: (typeof CRITERIA)[number]) =>
      `${agreed(byJudge, criterion)} (${byJudge.map((result) => result.outcome[criterion]).join('/')})`;
    const overall = agreed(byJudge, 'overall');
    totals[overall] = (totals[overall] ?? 0) + 1;
    const unsupported = (side: 'inventedFirst' | 'inventedSecond') =>
      byJudge.map((result) => result[side].length).join('/');
    rows.push(
      `| ${file.name} | ${CRITERIA.map(cell).join(' | ')} | ${unsupported('inventedFirst')} | ${unsupported('inventedSecond')} |`,
    );
    byJudge.forEach((result, i) => {
      details.push(
        `**${file.name}** — ${judges[i]?.name ?? ''}`,
        ...result.notes.map((n) => `- ${n}`),
      );
      details.push(...result.inventedFirst.map((claim) => `  - first: ${claim}`));
      details.push(...result.inventedSecond.map((claim) => `  - second: ${claim}`));
    });
  }
  const cost = judges
    .flatMap((judge) => judge.calls)
    .reduce((sum, call) => sum + callCost(call), 0);
  return [
    `## Pairwise: second (${second}) against first (${first}); outcome for the second`,
    '',
    `Judges: ${judges.map((judge) => judge.name).join(', ')}. A cell is the agreed outcome (win or loss only when both judges in both orders agree, else split), then each judge's own outcome.`,
    '',
    `Overall agreed: win ${totals.win}, loss ${totals.loss}, split ${totals.split} of ${results.length}.`,
    '',
    `| file | ${CRITERIA.join(' | ')} | unsupported in first | unsupported in second |`,
    `| --- | ${CRITERIA.map(() => '---').join(' | ')} | --- | --- |`,
    ...rows,
    '',
    ...details,
    '',
    `Judge calls: ${judges.reduce((sum, judge) => sum + judge.calls.length, 0)}, $${cost.toFixed(2)}`,
  ].join('\n');
}

/** The model that writes the planted inventions (decision 036): not the reviewer's own. */
export const PLANTER_MODEL = 'claude-sonnet-5-5';

/**
 * The reviewer on every stored author answer, untouched and with inventions a second model planted;
 * a markdown report with recall per kind.
 */
export async function runReviewerTest(
  config: AppConfig,
  inputs: readonly EvalInput[],
  first: string,
): Promise<string> {
  const reviewer = evalClient(config);
  const planter = evalClient({ ...config, JUDGE_MODEL: PLANTER_MODEL });
  const job = { id: 'eval', lockedBy: 'eval' };
  const signal = new AbortController().signal;
  const rows: string[] = [];
  const findings: string[] = [];
  const totals = { items: 0, falseAlarms: 0 };
  const byKind = new Map<PlantKind, { planted: number; caught: number }>(
    PLANT_KINDS.map((kind) => [kind, { planted: 0, caught: 0 }]),
  );
  const results = await Promise.all(
    inputs.map(async (file) => {
      const { role } = file;
      const source = prepareSource(file.text);
      const author = authorOutputSchema.parse(
        JSON.parse(await readFile(join(first, `${file.name}.author.json`), 'utf8')),
      );
      const list = candidates(author, source);
      const { plants } = await planter.client.parse({
        role: 'judge',
        system: PLANTER_SYSTEM,
        input: plantInput(list, file.text),
        schema: plantsSchema,
        job,
        signal,
      });
      const { answer, planted } = applyPlants(author, source, plants);
      const review = (input: typeof author) =>
        reviewer.client.parse({ ...reviewRequest(source, input, role), job, signal });
      const [clean, dirty] = await Promise.all([review(author), review(answer)]);
      return { file, planted, clean, dirty, items: list.length };
    }),
  );
  for (const { file, planted, clean, dirty, items } of results) {
    const scored = score(dirty, planted);
    for (const plant of planted) {
      const count = byKind.get(plant.kind);
      if (!count) continue;
      count.planted++;
      if (scored.caught.includes(plant)) count.caught++;
    }
    totals.items += items;
    totals.falseAlarms += clean.issues.length;
    const kinds = (list: readonly Planted[]) => list.map((p) => p.kind).join(', ') || '—';
    rows.push(
      `| ${file.name} | ${planted.length} | ${kinds(scored.caught)} | ${kinds(scored.missed)} | ${clean.issues.length} / ${items} | ${scored.others.length} |`,
    );
    for (const plant of planted) {
      const hit = scored.caught.includes(plant) ? 'caught' : 'MISSED';
      findings.push(`- ${file.name} ${plant.item} ${plant.kind} ${hit}: ${plant.after}`);
    }
    for (const issue of clean.issues) {
      findings.push(
        `- ${file.name} clean ${issue.item} ${issue.action} ${issue.class}: ${issue.text ?? ''} ${issue.question ?? ''}`,
      );
    }
  }
  const planted = [...byKind.values()].reduce((sum, count) => sum + count.planted, 0);
  const caught = [...byKind.values()].reduce((sum, count) => sum + count.caught, 0);
  const cost = [...reviewer.calls, ...planter.calls].reduce((sum, call) => sum + callCost(call), 0);
  return [
    `## Reviewer test (${config.REVIEWER_MODEL}/${config.REVIEWER_EFFORT}; inventions by ${PLANTER_MODEL}) on ${first}`,
    '',
    `Recall: ${caught}/${planted}. False alarms on the clean answers: ${totals.falseAlarms} findings over ${totals.items} text items.`,
    '',
    '| kind | caught / planted |',
    '| --- | --- |',
    ...[...byKind].map(([kind, count]) => `| ${kind} | ${count.caught} / ${count.planted} |`),
    '',
    '| file | planted | caught | missed | clean: findings / text items | planted run: other findings |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    ...findings,
    '',
    `Calls: reviewer ${reviewer.calls.length}, planter ${planter.calls.length}, $${cost.toFixed(2)}`,
  ].join('\n');
}

const flatPosition = z.looseObject({ id: z.string(), bullets: z.array(z.unknown()) });
const flatSection = z.looseObject({ id: z.string(), items: z.array(z.unknown()) });
const flatSkill = z.looseObject({ name: z.string() });

/**
 * A dump made before decision 036 (`main`'s) in the shape of today's document, the way the data
 * migration Migration20261029140000_item_groups moves stored CVs.
 */
function withGroups(dump: unknown): unknown {
  const document = z.looseObject({
    experience: z.array(z.unknown()),
    additional: z.array(z.unknown()),
    skills: z.array(z.unknown()),
  });
  const parsed = document.safeParse(dump);
  if (!parsed.success) return dump;
  const group = (id: string, items: unknown[]) =>
    items.length === 0 ? [] : [{ id: `${id}-g1`, title: null, items }];
  // Skills before Z2 were one flat list: one untitled group, as Migration20261029120000 moved them.
  const flatSkills = parsed.data.skills.some((value) => flatSkill.safeParse(value).success);
  return {
    ...parsed.data,
    skills: flatSkills
      ? [{ id: 'k1', title: null, items: parsed.data.skills }]
      : parsed.data.skills,
    experience: parsed.data.experience.map((value) => {
      const position = flatPosition.safeParse(value);
      if (!position.success) return value;
      const { bullets, ...rest } = position.data;
      return { ...rest, groups: group(rest.id, bullets) };
    }),
    additional: parsed.data.additional.map((value) => {
      const section = flatSection.safeParse(value);
      if (!section.success) return value;
      const { items, ...rest } = section.data;
      const entries =
        items.length === 0
          ? []
          : [
              {
                id: `${rest.id}-e1`,
                title: '',
                start: null,
                end: null,
                groups: group(rest.id, items),
              },
            ];
      return { ...rest, entries };
    }),
  };
}
