import { describe, expect, it } from 'vitest';
import { flattenCommands, parseCommands } from './shell.ts';

describe('parseCommands', () => {
  it('splits on separators outside quotes only', () => {
    const commands = parseCommands('git commit -m "a && b; c | d" && pnpm test | tee out.log');
    expect(commands.map((c) => c.words)).toEqual([
      ['git', 'commit', '-m', 'a && b; c | d'],
      ['pnpm', 'test'],
      ['tee', 'out.log'],
    ]);
    expect(commands.map((c) => c.after)).toEqual([undefined, '&&', '|']);
  });

  it('treats command substitution as a command of its own', () => {
    expect(parseCommands('echo $(pnpm add x)').map((c) => c.words)).toEqual([
      ['echo'],
      ['pnpm', 'add', 'x'],
    ]);
  });
});

describe('flattenCommands', () => {
  it('drops env assignments and wrappers (but keeps sudo visible)', () => {
    expect(flattenCommands('CI=1 time env A=b pnpm add x')[0]?.words).toEqual(['pnpm', 'add', 'x']);
    expect(flattenCommands('sudo pnpm add x')[0]?.words[0]).toBe('sudo');
  });
  it('looks inside bash -c', () => {
    const words = flattenCommands('bash -c "cd x && pnpm add y"').map((c) => c.words.join(' '));
    expect(words).toContain('pnpm add y');
  });
});
