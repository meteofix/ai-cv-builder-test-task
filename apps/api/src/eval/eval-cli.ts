/**
 * Measures extraction and generation on a folder of CVs (PDF or .txt) against hand-written expectations.
 * The corpus is not in the repository (real people's CVs); its path is an argument.
 *
 *   pnpm --filter @cv/api build
 *   node apps/api/dist/eval/eval-cli.js --mode extract --corpus <dir> --expected <dir> --out ~/cv-eval/report.md
 *
 * Modes: `text` — only the PDF text (no model call); `extract` — text → extractor → fact checks, through
 * the real `LlmClient` (ANTHROPIC_API_KEY from the environment or the repository's `.env`); `full` —
 * the whole generation through a running app (`docker compose up`, `--base-url`). `--dump <dir>` writes
 * the text, the kept facts and the lines not recognized per file, for reading by hand. Reports name the
 * files and quote their positions, so `--out` and `--dump` must lie outside the repository or in a path
 * git ignores; the script refuses anything else.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { LIMITS } from '@cv/shared';
import { z } from 'zod';
import { loadConfig, loadEnvFile } from '../config/env.js';
import { extractSourceFacts } from '../generation/generate/extract-step.js';
import { extractPdfText } from '../sources/extract-pdf-text.js';
import { evalLlm } from './eval-llm.js';
import { parseExpected, type Expected } from './expected.js';
import { contentLineCount, measureExtraction } from './extraction-metrics.js';
import { measureFullRun } from './full-metrics.js';
import { ApiSession } from './full-run.js';
import {
  extractionTable,
  fullTable,
  positionDetails,
  type ExtractionRow,
  type FullRow,
} from './report.js';

const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'extract' },
    corpus: { type: 'string' },
    expected: { type: 'string' },
    out: { type: 'string' },
    dump: { type: 'string' },
    only: { type: 'string' },
    'base-url': { type: 'string', default: 'http://localhost:8080' },
    role: { type: 'string', default: 'Senior Software Engineer' },
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

const MODES = z.enum(['text', 'extract', 'full']);

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

async function runExtract(files: CorpusFile[]): Promise<string> {
  loadEnvFile();
  const config = loadConfig();
  const llm = evalLlm(config);
  const rows: ExtractionRow[] = [];
  for (const file of files) {
    const started = performance.now();
    const text = await sourceText(file);
    const textMs = performance.now() - started;
    const before = llm.calls.length;
    const { stored, counters } = await extractSourceFacts(text, llm.ask);
    const metrics = measureExtraction({
      text,
      stored,
      dropped: counters.dropped,
      placed: { reattached: counters.reattached, unplaced: counters.unplaced },
      expected: await expectedFor(file),
    });
    rows.push({ name: file.name, metrics, textMs, calls: llm.calls.slice(before) });
    write(`${file.name}: kept ${metrics.kept}, not recognized ${metrics.uncovered}`);
    await dump(file, {
      txt: text,
      'facts.json': JSON.stringify(stored.facts, null, 2),
      'uncovered.txt': stored.uncoveredLines.join('\n'),
    });
  }
  return [
    `## Extract only (${rows.length} files, ${llm.calls.length} model calls; a job stops at ${config.LLM_CALL_BUDGET})`,
    '',
    extractionTable(rows),
    '',
    ...rows.map((row) => positionDetails(row.name, row.metrics.matches)).filter(Boolean),
    '',
    `PDF text ms: ${rows.map((row) => `${row.name} ${Math.round(row.textMs)}`).join(', ')}`,
  ].join('\n');
}

async function runFull(files: CorpusFile[]): Promise<string> {
  const rows: FullRow[] = [];
  const unverified: string[] = [];
  for (const file of files) {
    const session = await ApiSession.signUp(values['base-url']);
    const text = await sourceText(file);
    const source = file.pdf ? { pdf: new Uint8Array(await readFile(file.path)) } : { text };
    const run = await session.generate(source, values.role);
    const metrics = measureFullRun(run, await expectedFor(file));
    rows.push({
      name: file.name,
      metrics,
      // Headings are unknown here; every line with a letter counts, so the share is a lower bound.
      contentLines: contentLineCount(text, []),
      steps: run.steps,
      totalMs: run.totalMs,
    });
    unverified.push(`**${file.name}**`, ...metrics.unverified.map((item) => `- ${item}`));
    write(`${file.name}: ${Math.round(run.totalMs / 1000)} s`);
    await dump(file, {
      'document.json': JSON.stringify(run.detail.document, null, 2),
      'not-in-cv.json': JSON.stringify(run.notInCv, null, 2),
      'questions.json': JSON.stringify(run.detail.questions, null, 2),
    });
  }
  return [
    `## Full generation (${rows.length} files, target role "${values.role}")`,
    '',
    fullTable(rows),
    '',
    ...rows.map((row) => positionDetails(row.name, row.metrics.matches)).filter(Boolean),
    '',
    "### Couldn't verify",
    '',
    ...unverified,
  ].join('\n');
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
      : mode === 'full'
        ? await runFull(files)
        : await runExtract(files);
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
