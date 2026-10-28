import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectWorktree } from '../../apps/api/src/config/worktree.ts';

const repoRoot = resolve(import.meta.dirname, '../..');

/** A fake main copy and a linked worktree next to it: `.git` is a directory in one and a `gitdir:` file in the other. */
function fixture(stream: string | undefined) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hooks-')));
  const main = join(base, 'main');
  const worktree = join(base, 'wt');
  mkdirSync(join(main, '.git', 'worktrees', 'wt'), { recursive: true });
  mkdirSync(join(worktree, '.claude'), { recursive: true });
  writeFileSync(join(worktree, '.git'), `gitdir: ${join(main, '.git', 'worktrees', 'wt')}\n`);
  if (stream) {
    writeFileSync(
      join(worktree, '.claude', 'settings.local.json'),
      JSON.stringify({ env: { CV_STREAM: stream } }),
    );
  }
  return { base, main, worktree };
}

/** Runs a hook the way Claude Code does: JSON on stdin, exit code 2 blocks the call. */
function runHook(hook: string, stdin: string) {
  // A clean environment: CV_STREAM of the session running the tests must not leak in.
  const result = spawnSync('node', [join(repoRoot, '.claude', 'hooks', `${hook}.ts`)], {
    input: stdin,
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  });
  return { status: result.status, stderr: result.stderr };
}

const call = (cwd: string, tool_name: string, tool_input: Record<string, unknown>) =>
  JSON.stringify({ cwd, tool_name, tool_input });

describe('detectWorktree', () => {
  it('recognises a linked worktree from its .git file, without running git', () => {
    const { main, worktree } = fixture(undefined);
    expect(detectWorktree(join(worktree, 'apps'))).toEqual({
      isWorktree: true,
      root: worktree,
      mainRoot: main,
    });
  });

  it('treats a directory with a .git directory as the main copy, and a place without git as not a worktree', () => {
    const { main, base } = fixture(undefined);
    expect(detectWorktree(main).isWorktree).toBe(false);
    expect(detectWorktree(base).isWorktree).toBe(false);
  });
});

describe('hook entry points', () => {
  it('zone-guard blocks with exit code 2 outside the zone and lets the zone through', () => {
    const { worktree } = fixture('auth');
    const outside = runHook(
      'zone-guard',
      call(worktree, 'Write', { file_path: join(worktree, 'apps/api/src/common/x.ts') }),
    );
    expect(outside.status).toBe(2);
    expect(outside.stderr).toContain('outside the zone of "auth"');
    const inside = runHook(
      'zone-guard',
      call(worktree, 'Write', { file_path: join(worktree, 'apps/api/src/auth/x.ts') }),
    );
    expect(inside.status).toBe(0);
  });

  it('zone-guard stops every edit in a worktree that was not set up', () => {
    const { worktree } = fixture(undefined);
    const result = runHook(
      'zone-guard',
      call(worktree, 'Edit', { file_path: join(worktree, 'apps/api/src/auth/x.ts') }),
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('pnpm worktree:init');
  });

  it('zone-guard lets the main copy change anything', () => {
    const { main } = fixture(undefined);
    expect(
      runHook('zone-guard', call(main, 'Write', { file_path: join(main, 'package.json') })).status,
    ).toBe(0);
  });

  it.each(['zone-guard', 'bash-guard', 'env-guard'])(
    '%s fails closed on input it cannot parse',
    (hook) => {
      expect(runHook(hook, 'not json').status).toBe(2);
    },
  );

  it('bash-guard exits 2 for a forbidden command and 0 for an ordinary one', () => {
    const { worktree } = fixture('auth');
    expect(
      runHook('bash-guard', call(worktree, 'Bash', { command: 'pnpm add left-pad' })).status,
    ).toBe(2);
    expect(
      runHook('bash-guard', call(worktree, 'Bash', { command: 'pnpm --filter @cv/api test' }))
        .status,
    ).toBe(0);
  });

  it('env-guard exits 2 for a secret file and 0 for the example file', () => {
    const { worktree } = fixture('auth');
    const secret = join(worktree, ['.', 'env'].join(''));
    expect(runHook('env-guard', call(worktree, 'Read', { file_path: secret })).status).toBe(2);
    expect(
      runHook('env-guard', call(worktree, 'Read', { file_path: `${secret}.example` })).status,
    ).toBe(0);
  });
});
