import { detectWorktree } from '../../apps/api/src/config/worktree.ts';
import { checkBash } from '../../scripts/lib/guards.ts';
import { block, guard } from '../../scripts/lib/hook-io.ts';

// PreToolUse for Bash: dangerous commands everywhere; in a worktree also changes to main and to dependencies.
await guard((input) => {
  const command = input.tool_input?.command;
  if (typeof command !== 'string') return;
  const info = detectWorktree(input.cwd);
  const reason = checkBash(command, {
    inWorktree: info.isWorktree,
    cwd: input.cwd ?? process.cwd(),
    projectRoot: info.root,
    mainRoot: info.mainRoot,
  });
  if (reason) block(reason);
});
