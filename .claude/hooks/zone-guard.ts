import { detectWorktree } from '../../apps/api/src/config/worktree.ts';
import { checkEdit } from '../../scripts/lib/guards.ts';
import { block, guard, streamState } from '../../scripts/lib/hook-io.ts';

// PreToolUse for Edit|Write: a worktree changes only the files of its own area.
await guard((input) => {
  const info = detectWorktree(input.cwd);
  const filePath = input.tool_input?.file_path;
  if (typeof filePath !== 'string') return;
  const reason = checkEdit(info, streamState(info), filePath);
  if (reason) block(reason);
});
