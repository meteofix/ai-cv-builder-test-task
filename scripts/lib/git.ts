import { execFileSync } from 'node:child_process';

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Paths from a `--name-only -z` style command: NUL-separated, so non-ASCII names are not quoted by git. */
export function gitPaths(cwd: string, ...args: string[]): string[] {
  return git(cwd, ...args, '-z')
    .split('\0')
    .filter(Boolean);
}
