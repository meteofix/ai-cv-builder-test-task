import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

// This file is imported by the API, by scripts/ and by the Claude hooks: keep it free of project imports.

export const STREAMS = ['auth', 'pipeline', 'web'] as const;
export type Stream = (typeof STREAMS)[number];

export interface WorktreeInfo {
  /** True only for a linked git worktree; a plain clone or a Docker image (no git) is not one. */
  isWorktree: boolean;
  root: string;
  mainRoot: string;
}

export class WorktreeNotConfiguredError extends Error {
  constructor() {
    super(
      'This git worktree is not set up: run `pnpm worktree:init <auth|pipeline|web>` first. ' +
        'It writes .env and .claude/settings.local.json with the stream, ports and databases.',
    );
  }
}

/**
 * Finds out whether `cwd` is in a linked git worktree by reading the `.git` entry itself, not by running
 * git: a missing git binary or a "dubious ownership" error must never turn a worktree into "the main copy"
 * (that would switch every guard off). In a linked worktree `.git` is a file: `gitdir: <main>/.git/worktrees/<name>`.
 */
export function detectWorktree(cwd: string = process.cwd()): WorktreeInfo {
  const start = resolve(cwd);
  for (let dir = start; ; dir = dirname(dir)) {
    const entry = join(dir, '.git');
    if (existsSync(entry)) {
      if (statSync(entry).isDirectory()) return { isWorktree: false, root: dir, mainRoot: dir };
      const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(entry, 'utf8'))?.[1]?.trim();
      const marker = `${sep}.git${sep}worktrees${sep}`;
      const at = gitdir === undefined ? -1 : resolve(dir, gitdir).indexOf(marker);
      if (gitdir === undefined || at === -1) return { isWorktree: false, root: dir, mainRoot: dir };
      return { isWorktree: true, root: dir, mainRoot: resolve(dir, gitdir).slice(0, at) };
    }
    if (dirname(dir) === dir) return { isWorktree: false, root: start, mainRoot: start };
  }
}

export function isStream(value: string | undefined): value is Stream {
  return STREAMS.some((stream) => stream === value);
}

/**
 * The stream this checkout works on (`CV_STREAM`), or `undefined` for the main copy.
 * A linked worktree without a stream would silently share the main databases and have no zones, so it stops.
 */
export function resolveStream(info: WorktreeInfo, env: NodeJS.ProcessEnv): Stream | undefined {
  const value = env.CV_STREAM;
  if (value) {
    if (!isStream(value))
      throw new Error(`CV_STREAM must be one of ${STREAMS.join(', ')}, got "${value}".`);
    return value;
  }
  if (info.isWorktree) throw new WorktreeNotConfiguredError();
  return undefined;
}

export interface DatabaseNames {
  /** Working database of the app. The web stream runs on a mock API, but still gets its own name so an API started there never touches the main database. */
  dev: string;
  test: string;
}

export function databaseNames(stream: Stream | undefined): DatabaseNames {
  if (!stream) return { dev: 'cv', test: 'cv_test' };
  return { dev: `cv_dev_${stream}`, test: `cv_test_${stream}` };
}
