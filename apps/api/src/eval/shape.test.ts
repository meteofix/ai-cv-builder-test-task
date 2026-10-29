import { describe, expect, it } from 'vitest';
import { sampleDocument } from '../../test/support/factories.js';
import { LONG_BULLET_CHARS, shapeOf } from './shape.js';

describe('shapeOf', () => {
  const document = (titles: (string | null)[], texts: string[]) => {
    const base = sampleDocument();
    const [first] = base.experience;
    if (!first) throw new Error('the sample has a position');
    return {
      ...base,
      experience: [
        {
          ...first,
          groups: titles.map((title, g) => ({
            id: `p1-g${g + 1}`,
            title,
            items: texts.map((text, i) => ({ id: `p1-b${g * 10 + i + 1}`, text, factIds: [] })),
          })),
        },
      ],
      additional: [],
    };
  };

  it('measures bullets across groups: median, longest and the ones over two lines', () => {
    const shape = shapeOf(document([null], ['a'.repeat(10), 'b'.repeat(50), 'c'.repeat(300)]), '');
    expect(shape).toMatchObject({ bullets: 3, medianChars: 50, maxChars: 300, long: 1 });
    expect(300).toBeGreaterThan(LONG_BULLET_CHARS);
  });

  it.each([
    ['a title the source has, in other case and spacing', 'PLATFORM  &  Backend', []],
    ['a title the source does not have', 'Team Leadership', ['Team Leadership']],
  ])('counts %s', (_case, title, invented) => {
    const shape = shapeOf(document([title, null], ['x']), 'Experience\nPlatform & backend\n• x');
    expect(shape.titledGroups).toBe(1);
    expect(shape.inventedTitles).toEqual(invented);
  });
});
