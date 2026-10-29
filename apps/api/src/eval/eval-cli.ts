/**
 * Measures generation on a folder of CVs (PDF or .txt) against hand-written expectations, and compares two
 * runs blind. The corpus is not in the repository (real people's CVs); its path is an argument.
 *
 *   pnpm --filter @cv/api build
 *   node apps/api/dist/eval/eval-cli.js --mode compose --corpus <dir> --expected <dir> --dump <dir> --out <file>
 *   node apps/api/dist/eval/eval-cli.js --mode pairwise --corpus <dir> --first <dump> --second <dump> --out <file>
 *
 * Modes: `text` — only the PDF text (no model call); `compose` — the whole generation through the real
 * `LlmClient` and the same steps the job runs (ANTHROPIC_API_KEY from the environment or the repository's
 * `.env`), with the time, tokens and cost of every call; `pairwise` — two earlier `compose` dumps judged
 * against each other per file, blind and in both orders. `--roles <json>` maps file names to target roles.
 * Reports name the files and quote their content, so `--out` and `--dump` must lie outside the repository
 * or in a path git ignores; the script refuses anything else.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { LIMITS } from '@cv/shared';
import { z } from 'zod';
import { loadConfig, loadEnvFile } from '../config/env.js';
import { pdfPager, shapeOf, type Shape } from './shape.js';
import { extractPdfText } from '../sources/extract-pdf-text.js';
import { callCost, COMPOSE_HEADER, composeRow, runCompose } from './compose-eval.js';
import { runPairwise, runReviewerTest } from './eval-runs.js';
import { parseExpected, type Expected } from './expected.js';

const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'compose' },
    corpus: { type: 'string' },
    expected: { type: 'string' },
    out: { type: 'string' },
    dump: { type: 'string' },
    only: { type: 'string' },
    role: { type: 'string', default: 'Senior Software Engineer' },
    /** A JSON file mapping file names to target roles; a file it does not name gets --role. */
    roles: { type: 'string' },
    /** pairwise: dump folders (`--dump` of earlier runs) of the baseline and of the candidate. */
    first: { type: 'string' },
    second: { type: 'string' },
  },
});

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

interface CorpusFile {
  name: string;
  path: string;
  pdf: boolean;
}

const MODES = z.enum(['text', 'compose', 'pairwise', 'reviewer-test']);

/** Refuses an output path git would pick up: CV text and real names must never reach a commit. */
function assertPrivate(path: string): void {
  const absolute = resolve(path);
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: dirname(new URL(import.meta.url).pathname),
    encoding: 'utf8',
  }).trim();
  if (relative(root, absolute).startsWith('..')) return;
  try {
    execFileSync('git', ['check-ignore', '-q', absolute], { cwd: root });
  } catch {
    throw new Error(`${path} is inside the repository and not ignored by git; write it elsewhere`);
  }
}

async function corpusFiles(dir: string): Promise<CorpusFile[]> {
  const names = (await readdir(dir)).filter((name) => /\.(pdf|txt)$/i.test(name)).sort();
  const only = values.only?.split(',');
  return names
    .map((name) => ({
      name: basename(name, extname(name)),
      path: join(dir, name),
      pdf: /\.pdf$/i.test(name),
    }))
    .filter((file) => !only || only.includes(file.name));
}

async function sourceText(file: CorpusFile): Promise<string> {
  if (!file.pdf) return (await readFile(file.path, 'utf8')).trim();
  const result = await extractPdfText(new Uint8Array(await readFile(file.path)), {
    maxPages: LIMITS.maxPdfPages,
    timeoutMs: 30_000,
  });
  if (!result.ok) throw new Error(`${file.name}: the PDF could not be read (${result.reason})`);
  return result.text;
}

async function expectedFor(file: CorpusFile): Promise<Expected | null> {
  if (!values.expected) return null;
  const path = join(values.expected, `${file.name}.md`);
  const markdown = await readFile(path, 'utf8').catch((error: unknown) => {
    // A CV without an expectation is still measured; any other read error is a broken setup.
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  });
  if (markdown === null) write(`${file.name}: no expectation at ${path}`);
  return markdown === null ? null : parseExpected(markdown);
}

async function dump(file: CorpusFile, parts: Record<string, string>): Promise<void> {
  if (!values.dump) return;
  await mkdir(values.dump, { recursive: true });
  for (const [suffix, content] of Object.entries(parts)) {
    await writeFile(join(values.dump, `${file.name}.${suffix}`), content);
  }
}

async function runText(files: CorpusFile[]): Promise<string> {
  for (const file of files) await dump(file, { txt: await sourceText(file) });
  return `Text of ${files.length} files written to ${values.dump ?? '(no --dump given)'}.`;
}

async function runComposeMode(files: CorpusFile[]): Promise<string> {
  loadEnvFile();
  const config = loadConfig();
  const roles = await roleMap();
  const rows: string[][] = [];
  const shapes: string[][] = [];
  const calls: string[] = [];
  const reasks: string[] = [];
  const reasked = { author: 0, reviewer: 0 };
  const notes: string[] = [];
  const pager = await pdfPager();
  for (const file of files) {
    const role = roles[file.name] ?? values.role;
    const text = await sourceText(file);
    const run = await runCompose(config, text, role);
    rows.push(composeRow(file.name, run, await expectedFor(file)));
    calls.push(
      ...run.calls.map(
        (call) =>
          `| ${file.name} | ${call.role} | ${call.model} | ${(call.latencyMs / 1000).toFixed(1)} | ${call.inputTokens} | ${call.cacheReadTokens} | ${call.cacheWriteTokens} | ${call.outputTokens} | ${call.outcome} | $${callCost(call).toFixed(3)} |`,
      ),
    );
    write(`${file.name}: ${Math.round(run.totalMs / 1000)} s`);
    reasks.push(...run.problems.map((problem) => `- ${file.name} ${problem.replace(/\s+/g, ' ')}`));
    for (const role of ['author', 'reviewer'] as const) {
      if (run.calls.filter((call) => call.role === role).length > 1) reasked[role]++;
    }
    if (!run.ok) continue;
    if (run.author.structureNotes) notes.push(`- ${file.name}: ${run.author.structureNotes}`);
    shapes.push(
      shapeRow(
        file.name,
        shapeOf(run.composed.document, text),
        await pager.pages(run.composed.document),
      ),
    );
    await dump(file, {
      'document.json': JSON.stringify(run.composed.document, null, 2),
      'not-in-cv.json': JSON.stringify(run.composed.analysis, null, 2),
      'questions.json': JSON.stringify(run.composed.questions, null, 2),
      'author.json': JSON.stringify(run.author, null, 2),
      'review.json': JSON.stringify(run.review, null, 2),
      role: role,
    });
  }
  await pager.close();
  const line = (cells: readonly string[]) => `| ${cells.join(' | ')} |`;
  return [
    `## Compose (${rows.length} files; author ${config.AUTHOR_MODEL}/${config.AUTHOR_EFFORT}, reviewer ${config.REVIEWER_MODEL}/${config.REVIEWER_EFFORT})`,
    '',
    line(COMPOSE_HEADER),
    line(COMPOSE_HEADER.map(() => '---')),
    ...rows.map(line),
    '',
    '### Calls',
    '',
    '| file | role | model | s | input | cache read | cache write | output | outcome | cost |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...calls,
    '',
    '### Shape',
    '',
    line(SHAPE_HEADER),
    line(SHAPE_HEADER.map(() => '---')),
    ...shapes.map(line),
    '',
    '### Structure notes (author, not shown to the person)',
    '',
    ...(notes.length > 0 ? notes : ['none']),
    '',
    '### Re-asks',
    '',
    `Files with a re-ask: author ${reasked.author} of ${files.length}, reviewer ${reasked.reviewer} of ${files.length}.`,
    '',
    ...(reasks.length > 0 ? reasks : ['none']),
  ].join('\n');
}

const SHAPE_HEADER = [
  'file',
  'pages',
  'bullets',
  'median / max chars',
  'over 2 lines',
  'summary chars',
  'entries',
  'titled groups',
  'titles not in the source',
];

function shapeRow(name: string, shape: Shape, pages: number): string[] {
  return [
    name,
    `${pages}`,
    `${shape.bullets}`,
    `${shape.medianChars} / ${shape.maxChars}`,
    `${shape.long}`,
    `${shape.summaryChars}`,
    `${shape.entries}`,
    `${shape.titledGroups}`,
    shape.inventedTitles.join('; ') || '—',
  ];
}

async function roleMap(): Promise<Record<string, string>> {
  if (!values.roles) return {};
  return z.record(z.string(), z.string()).parse(JSON.parse(await readFile(values.roles, 'utf8')));
}

/** The modes that read earlier dumps: the inputs with their text and role, then the run. */
async function runComparing(
  mode: 'pairwise' | 'reviewer-test',
  files: CorpusFile[],
): Promise<string> {
  if (!values.first) throw new Error(`${mode} needs --first <dump of a compose run>`);
  loadEnvFile();
  const config = loadConfig();
  const roles = await roleMap();
  const inputs = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      text: await sourceText(file),
      role: roles[file.name] ?? values.role,
    })),
  );
  if (mode === 'reviewer-test') return runReviewerTest(config, inputs, values.first);
  if (!values.second) throw new Error('pairwise needs --second');
  return runPairwise(config, inputs, values.first, values.second);
}

async function main(): Promise<void> {
  const mode = MODES.parse(values.mode);
  if (!values.corpus) throw new Error('--corpus <dir> is required');
  if (values.out) assertPrivate(values.out);
  if (values.dump) assertPrivate(values.dump);
  const files = await corpusFiles(values.corpus);
  if (files.length === 0) throw new Error('No .pdf or .txt file matches --corpus and --only');
  const report =
    mode === 'text'
      ? await runText(files)
      : mode === 'compose'
        ? await runComposeMode(files)
        : await runComparing(mode, files);
  if (values.out) await writeFile(values.out, `${report}\n`);
  write(report);
}

main().catch((error: unknown) => {
  // The message only: a stack or a cause could carry part of a CV.
  process.stderr.write(
    `eval failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
  );
  process.exitCode = 1;
});
