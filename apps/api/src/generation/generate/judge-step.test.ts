import { describe, expect, it } from 'vitest';
import { applyVerdicts, type ItemToJudge } from './judge-step.js';
import type { JudgeOutput } from './schemas.js';

const ITEMS: ItemToJudge[] = [
  { id: 's1', text: 'Summary.', quotes: ['q'], positionId: null },
  { id: 'b1', text: 'Bullet.', quotes: ['q'], positionId: 'f4' },
];
type Verdicts = JudgeOutput['verdicts'];

describe('applyVerdicts (fail closed)', () => {
  it.each<[string, Verdicts, { itemId: string; class: string }[]]>([
    [
      'all supported',
      [
        { itemId: 's1', supported: true },
        { itemId: 'b1', supported: true },
      ],
      [],
    ],
    [
      'a rejection keeps its class',
      [
        { itemId: 's1', supported: true },
        { itemId: 'b1', supported: false, class: 'moved_between_jobs' },
      ],
      [{ itemId: 'b1', class: 'moved_between_jobs' }],
    ],
    [
      'a rejection without a class is an unsupported claim',
      [
        { itemId: 's1', supported: true },
        { itemId: 'b1', supported: false },
      ],
      [{ itemId: 'b1', class: 'unsupported_claim' }],
    ],
    [
      'an item without a verdict is removed',
      [{ itemId: 's1', supported: true }],
      [{ itemId: 'b1', class: 'no_verdict' }],
    ],
    [
      'no verdicts at all remove everything',
      [],
      [
        { itemId: 's1', class: 'no_verdict' },
        { itemId: 'b1', class: 'no_verdict' },
      ],
    ],
    [
      'the first verdict for an item counts',
      [
        { itemId: 's1', supported: false, class: 'role_keyword' },
        { itemId: 's1', supported: true },
        { itemId: 'b1', supported: true },
      ],
      [{ itemId: 's1', class: 'role_keyword' }],
    ],
    [
      'a verdict for an unknown item does not stand in for a real one',
      [
        { itemId: 'zz', supported: true },
        { itemId: 's1', supported: true },
      ],
      [{ itemId: 'b1', class: 'no_verdict' }],
    ],
  ])('%s', (_case, verdicts, expected) => {
    const removed = applyVerdicts(ITEMS, verdicts);
    expect(
      removed.map(({ itemId, class: removalClass }) => ({ itemId, class: removalClass })),
    ).toEqual(expected);
  });

  it('keeps the text and the position of a removed item', () => {
    expect(applyVerdicts(ITEMS, [])[1]).toEqual({
      itemId: 'b1',
      text: 'Bullet.',
      positionId: 'f4',
      class: 'no_verdict',
    });
  });
});
