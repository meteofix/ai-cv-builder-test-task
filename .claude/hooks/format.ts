import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import { detectWorktree } from '../../apps/api/src/config/worktree.ts';
import { readHookInput } from '../../scripts/lib/hook-io.ts';

// PostToolUse for Edit|Write: Prettier on the changed file, so diffs stay clean. Never blocks.
const input = await readHookInput();
const file = input.tool_input?.file_path;
const cwd = input.cwd ?? process.cwd();
// Only files of this checkout: AI_LOG.md and .reviews/ of the main copy must stay exactly as written.
const inCheckout = (path: string) => {
  const rel = relative(detectWorktree(cwd).root, path);
  return !rel.startsWith('..') && !isAbsolute(rel);
};

if (
  typeof file === 'string' &&
  existsSync(file) &&
  inCheckout(file) &&
  /\.(ts|tsx|js|json|md|ya?ml|css|html)$/.test(file)
) {
  // Private files are excluded through .git/info/exclude, which Prettier does not know about.
  const ignored = spawnSync('git', ['check-ignore', '-q', file], { cwd }).status === 0;
  if (!ignored) {
    try {
      execFileSync(
        'pnpm',
        ['exec', 'prettier', '--write', '--ignore-unknown', '--log-level', 'warn', file],
        {
          cwd,
          stdio: 'ignore',
        },
      );
    } catch {
      // A syntax error shows up in the next typecheck or lint; formatting must not interrupt the edit.
    }
  }
}
