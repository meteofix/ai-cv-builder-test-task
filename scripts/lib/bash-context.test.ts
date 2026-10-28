import { describe, expect, it } from 'vitest';
import { checkBash, type BashContext } from './guards.ts';

const worktree: BashContext = {
  inWorktree: true,
  cwd: '/w/proj',
  projectRoot: '/w/proj',
  mainRoot: '/m/proj',
};
const main: BashContext = { inWorktree: false, cwd: '/m/proj', projectRoot: '/m/proj' };

describe('cd is tracked inside one command', () => {
  it.each([
    ['cd .. && rm -rf main-copy'],
    ['cd / && rm -rf Users'],
    ['cd "$SOMEWHERE" && rm -rf build'],
    ['cd /Users/someone && rm -rf other'],
  ])('blocks %s', (command) => {
    expect(checkBash(command, worktree)).toBeTypeOf('string');
  });

  it.each([
    ['cd apps/api && rm -rf dist'],
    ['cd /tmp/scratch && rm -rf out'],
    ['cd apps && cd .. && rm -rf dist'],
  ])('allows %s', (command) => {
    expect(checkBash(command, worktree)).toBeUndefined();
  });
});

describe('a worktree cannot change the main copy through git', () => {
  it.each([
    ['git -C /m/proj commit -m x'],
    ['git -C /m/proj merge stream/auth'],
    ['git -C /m/proj reset --hard'],
    ['cd /m/proj && git checkout -- .'],
    ['cd /m/proj && git add -A'],
    ['cd "$X" && git commit -m x'],
  ])('blocks %s', (command) => {
    expect(checkBash(command, worktree)).toBeTypeOf('string');
  });

  it.each([
    ['git -C /m/proj status'],
    ['git -C /m/proj log --oneline'],
    ['git commit -m "docs: x"'],
    ['git -C /w/proj add apps'],
    ['cd /m/proj && git diff main...stream/auth'],
  ])('allows %s', (command) => {
    expect(checkBash(command, worktree)).toBeUndefined();
  });

  it('does not apply in the main copy itself', () => {
    expect(checkBash('git commit -m x', main)).toBeUndefined();
  });
});

describe('wipes of shared scratch space', () => {
  it.each([['rm -rf /tmp/*'], ['rm -rf /private/tmp/*'], ['rm -rf /var/folders/*']])(
    'blocks %s',
    (command) => {
      expect(checkBash(command, main)).toBeTypeOf('string');
    },
  );
});

describe('push is never allowed, with any flag spelling', () => {
  it.each([['git push -fu origin main'], ['git push origin main'], ['/usr/bin/git push']])(
    'blocks %s',
    (command) => {
      expect(checkBash(command, main)).toBeTypeOf('string');
      expect(checkBash(command, worktree)).toBeTypeOf('string');
    },
  );
});
