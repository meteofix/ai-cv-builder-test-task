import { describe, expect, it } from 'vitest';
import { checkBash, checkEnvAccess } from './guards.ts';

const wt = { inWorktree: true, cwd: '/w/proj', projectRoot: '/w/proj' };
describe('repro of review findings (must all be blocked)', () => {
  it.each([
    ["python3 - <<'EOF'\nprint(open('.env').read())\nEOF", 'env'],
    ["bash <<'EOF'\npnpm add zod\nEOF", 'bash'],
    ["cat <<'EOF' | sh\npnpm add zod\nEOF", 'bash'],
    ['/bin/rm -rf ~', 'bash'],
    ['/usr/bin/git push -f', 'bash'],
    ['timeout 60 pnpm add x', 'bash'],
    ['env -i pnpm add x', 'bash'],
    ['nice -n 5 pnpm add x', 'bash'],
    ['for d in a; do rm -rf "$d"; done', 'bash'],
    ['if true; then git push -f; fi', 'bash'],
    ['{ rm -rf /; }', 'bash'],
    ["bash -lc 'pnpm add x'", 'bash'],
    ['pnpm \\\n add zod', 'bash'],
    ['git push -fu origin main', 'bash'],
    ['cat .*', 'env'],
    ['cat .e*', 'env'],
    ['cat .?nv', 'env'],
    ['grep -rn ANTHROPIC .', 'env'],
    ['find . -name ".e*" -exec cat {} +', 'env'],
    ['docker compose config', 'env'],
    ['cat .ENV', 'env'],
  ])('%s', (command, kind) => {
    const reason = kind === 'env' ? checkEnvAccess('Bash', { command }) : checkBash(command, wt);
    expect(reason).toBeTypeOf('string');
  });
});
