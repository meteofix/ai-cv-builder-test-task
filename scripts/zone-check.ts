import { detectWorktree, isStream, type Stream } from '../apps/api/src/config/worktree.ts';
import { streamState } from './lib/hook-io.ts';
import { gitPaths } from './lib/git.ts';
import { isAllowed } from './lib/zones.ts';

// Usage:
//   pnpm zone:check --staged             staged files against the stream of this worktree (CV_STREAM)
//   pnpm zone:check <stream> <git-range> files changed in a range, e.g. `pnpm zone:check auth main...HEAD`
// Exits 1 when a file lies outside the stream's zone; Edit|Write hooks cannot see changes made by Bash.

const [first, second] = process.argv.slice(2);
const info = detectWorktree();
const { root } = info;
let stream: Stream | undefined;
let files: string[];

if (first === '--staged') {
  const state = streamState(info);
  if (state.kind === 'unconfigured') {
    console.error(
      'zone:check: this worktree is not set up. Run `pnpm worktree:init <auth|pipeline|web>` first.',
    );
    process.exit(1);
  }
  if (state.kind === 'main') {
    console.log('zone:check: main copy, no zones to enforce.');
    process.exit(0);
  }
  stream = state.stream;
  files = gitPaths(root, 'diff', '--cached', '--name-only', '--no-renames');
} else if (isStream(first) && second) {
  stream = first;
  files = gitPaths(root, 'diff', '--name-only', '--no-renames', second);
} else {
  console.error(
    'Usage: pnpm zone:check --staged | pnpm zone:check <auth|pipeline|web> <git-range>',
  );
  process.exit(2);
}

const outside = files.filter((file) => !isAllowed(stream, file));
if (outside.length > 0) {
  console.error(`zone:check: ${outside.length} file(s) outside the zone of "${stream}":`);
  for (const file of outside) console.error(`  - ${file}`);
  console.error('Revert them, or ask the user (see "When to ask a human" in AGENTS.md).');
  process.exit(1);
}
console.log(`zone:check: ${files.length} file(s) checked, all inside the zone of "${stream}".`);
