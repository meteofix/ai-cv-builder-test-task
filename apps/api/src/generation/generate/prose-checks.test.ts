import { describe, expect, it } from 'vitest';
import type { Fact } from '../../grounding/index.js';
import { checkProse } from './prose-checks.js';
import { writerOutputSchema, type WriterOutput } from './schemas.js';
import { buildSkeleton } from './skeleton.js';

const SOURCE = 'Acme\nCut costs by 38%.\nGlobex\nGo, SQL';
const at = (text: string): [number, number] => [
  SOURCE.indexOf(text),
  SOURCE.indexOf(text) + text.length,
];
const position = (id: string, company: string): Fact => ({
  id,
  kind: 'position',
  quote: company,
  span: at(company),
  position: { company, title: '', location: null, start: null, end: null, current: true },
});
const FACTS: Fact[] = [
  position('f1', 'Acme'),
  {
    id: 'f2',
    kind: 'achievement',
    quote: 'Cut costs by 38%.',
    span: at('Cut costs by 38%.'),
    achievement: { positionId: 'f1' },
  },
  position('f3', 'Globex'),
  { id: 'f4', kind: 'skill', quote: 'Go, SQL', span: at('Go, SQL'), skill: { name: 'Go' } },
  { id: 'f5', kind: 'skill', quote: 'Go, SQL', span: at('Go, SQL'), skill: { name: 'SQL' } },
];

function output(overrides: Partial<WriterOutput> = {}): WriterOutput {
  return {
    summary: [{ text: 'Engineer.', factIds: ['f1'] }],
    positions: [],
    skills: ['f5', 'f4'],
    ...overrides,
  };
}

describe('checkProse', () => {
  it('numbers summary sentences s1… before filtering, so ids stay stable', () => {
    const { result } = checkProse(
      output({
        summary: [
          { text: 'Not referenced.', factIds: [] },
          { text: 'Engineer.', factIds: ['f1'] },
        ],
      }),
      FACTS,
      SOURCE,
    );
    expect(result.summary.map((sentence) => sentence.id)).toEqual(['s2']);
    expect(result.removed).toEqual([
      { itemId: 's1', text: 'Not referenced.', positionId: null, class: 'wrong_reference' },
    ]);
  });

  it('removes a bullet that cites another position, and one with a number not in its quotes', () => {
    const { result } = checkProse(
      output({
        positions: [
          {
            positionId: 'f3',
            bullets: [
              { text: 'Cut costs by 38%.', factIds: ['f2'] },
              { text: 'Grew sales by 38%.', factIds: ['f3'] },
            ],
          },
          { positionId: 'f1', bullets: [{ text: 'Cut costs by 38%.', factIds: ['f2'] }] },
        ],
      }),
      FACTS,
      SOURCE,
    );
    expect(result.removed.map((item) => [item.text, item.positionId, item.class])).toEqual([
      ['Cut costs by 38%.', 'f3', 'wrong_reference'],
      ['Grew sales by 38%.', 'f3', 'number_not_in_source'],
    ]);
    expect(result.positions.map((entry) => [entry.positionId, entry.bullets.length])).toEqual([
      ['f3', 0],
      ['f1', 1],
    ]);
  });

  it('drops bullets of an unknown or repeated position without a question', () => {
    const bullet = { text: 'Shipped.', factIds: ['f1'] };
    const check = checkProse(
      output({
        positions: [
          { positionId: 'f9', bullets: [bullet] },
          { positionId: 'f1', bullets: [bullet] },
          { positionId: 'f1', bullets: [bullet] },
        ],
      }),
      FACTS,
      SOURCE,
    );
    expect(check.unknownPositions).toBe(2);
    expect(check.result.positions.map((entry) => entry.positionId)).toEqual(['f1']);
    expect(check.result.removed).toEqual([]);
  });

  it('keeps the writer’s skill order and ignores ids that are not skills', () => {
    expect(
      checkProse(output({ skills: ['f5', 'f1', 'f9', 'f4'] }), FACTS, SOURCE).result.skills,
    ).toEqual(['f5', 'f4']);
  });
});

describe('the experience keeps the source order (decision 033)', () => {
  it('whatever order the writer lists positions in, and with a stray order field', () => {
    const raw = { ...output(), experienceOrder: ['f3', 'f1'] };
    const parsed = writerOutputSchema.parse({ ...raw, positions: [...raw.positions].reverse() });
    const { result } = checkProse(parsed, FACTS, SOURCE);
    const document = buildSkeleton({
      source: SOURCE,
      facts: FACTS,
      targetRole: 'Engineer',
      locale: 'en',
      prose: {
        summary: result.summary,
        bullets: new Map(result.positions.map(({ positionId, bullets }) => [positionId, bullets])),
        skills: result.skills,
      },
    });
    const sourceOrder = FACTS.filter((fact) => fact.kind === 'position').map((fact) => fact.id);
    expect(document.experience.map((job) => job.id)).toEqual(sourceOrder);
    expect(sourceOrder.length).toBeGreaterThan(1);
  });
});
