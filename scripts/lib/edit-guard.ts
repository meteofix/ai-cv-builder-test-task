import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Stream, WorktreeInfo } from '../../apps/api/src/config/worktree.ts';
import { isAllowed } from './zones.ts';

export type StreamState =
  { kind: 'main' } | { kind: 'unconfigured' } | { kind: 'stream'; stream: Stream }; // prettier-ignore

/** `realpath` of the nearest existing ancestor plus the rest, so /tmp and /private/tmp compare equal. */
function canonical(path: string): string {
  const absolute = resolve(path);
  let existing = absolute;
  const rest: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(existing), ...rest);
    } catch {
      rest.unshift(basename(existing));
      const parent = dirname(existing);
      if (parent === existing) return absolute;
      existing = parent;
    }
  }
}

function insideOf(root: string, target: string): string | undefined {
  const rel = relative(root, target);
  return rel.startsWith('..') || isAbsolute(rel) ? undefined : rel;
}

/** Rules for Edit and Write: a worktree changes only the files of its own area. */
export function checkEdit(
  info: WorktreeInfo,
  state: StreamState,
  filePath: string,
): string | undefined {
  if (state.kind === 'main') return undefined;
  if (state.kind === 'unconfigured') {
    return 'Blocked: worktree is not set up. Run `pnpm worktree:init <auth|pipeline|web>` first, then retry.';
  }
  const root = canonical(info.root);
  const target = canonical(isAbsolute(filePath) ? filePath : join(root, filePath));
  const inRoot = insideOf(root, target);
  if (inRoot !== undefined) {
    return isAllowed(state.stream, inRoot.split(sep).join('/'))
      ? undefined
      : `Blocked: ${inRoot} is outside the zone of "${state.stream}". Ask the user (see "When to ask a human" in AGENTS.md).`;
  }
  const inMain = insideOf(canonical(info.mainRoot), target);
  if (inMain !== undefined) {
    const allowed = inMain === 'AI_LOG.md' || inMain.startsWith(`.reviews${sep}`);
    return allowed
      ? undefined
      : `Blocked: ${inMain} belongs to the main copy; from a worktree only AI_LOG.md and .reviews/ can be written there.`;
  }
  return undefined;
}
