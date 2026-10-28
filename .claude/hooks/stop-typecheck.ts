import { spawnSync } from 'node:child_process';
import { readHookInput } from '../../scripts/lib/hook-io.ts';

// Stop: the agent may not finish with broken types. Runs only when TypeScript files changed, and never twice in a row.
const input = await readHookInput();
if (input.stop_hook_active) process.exit(0);

const cwd = input.cwd ?? process.cwd();
const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
  cwd,
  encoding: 'utf8',
});
const changedTs = status.stdout.split('\n').some((line) => /\.tsx?$/.test(line.trim()));
if (!changedTs) process.exit(0);

const result = spawnSync('pnpm', ['typecheck'], { cwd, encoding: 'utf8', timeout: 240_000 });
if (result.status === 0) process.exit(0);
if (result.status === null) {
  process.stderr.write(
    'pnpm typecheck did not finish in time (killed or timed out); run it yourself before finishing.\n',
  );
  process.exit(2);
}

const tail = `${result.stdout}${result.stderr}`.split('\n').slice(-60).join('\n');
process.stderr.write(`pnpm typecheck failed. Fix the errors before finishing:\n${tail}\n`);
process.exit(2);
