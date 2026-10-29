import { describe, expect, it } from 'vitest';
import type { Fact } from '../../grounding/index.js';
import { applyVerdicts, judgeEvidence, type ItemToJudge } from './judge-step.js';
import type { JudgeOutput } from './schemas.js';

const ITEMS: ItemToJudge[] = [
  { id: 's1', text: 'Summary.', destination: 'Summary', evidence: [], positionId: null },
  { id: 'b1', text: 'Bullet.', destination: 'Engineer — Acme', evidence: [], positionId: 'f4' },
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

describe('judgeEvidence', () => {
  const source = 'Senior Engineer, Acme\n- Led billing.\nEngineer, Globex\n- Built search.';
  const at = (text: string): [number, number] => [
    source.indexOf(text),
    source.indexOf(text) + text.length,
  ];
  const position = (id: string, title: string, company: string, quote: string): Fact => ({
    id,
    kind: 'position',
    quote,
    span: at(quote),
    position: { company, title, location: null, start: null, end: null, current: false },
  });
  const facts: Fact[] = [
    position('f1', 'Senior Engineer', 'Acme', 'Senior Engineer, Acme'),
    // The extractor put Acme's achievement under Globex: the mechanical checks accept the assignment.
    {
      id: 'f2',
      kind: 'achievement',
      quote: 'Led billing.',
      span: at('Led billing.'),
      achievement: { positionId: 'f3' },
    },
    position('f3', 'Engineer', 'Globex', 'Engineer, Globex'),
    {
      id: 'f4',
      kind: 'achievement',
      quote: 'Built search.',
      span: at('Built search.'),
      achievement: { positionId: 'f3' },
    },
  ];

  it('shows the judge where each quote stands in the source, so a moved duty is visible', () => {
    const { destination, evidence } = judgeEvidence(facts, source, source.length);
    expect(destination('f3')).toBe('Engineer — Globex (? – ?)');
    expect(evidence(['f2', 'f4'])).toEqual([
      { quote: 'Led billing.', appearsUnder: 'Senior Engineer — Acme (? – ?)' },
      { quote: 'Built search.', appearsUnder: 'Engineer — Globex (? – ?)' },
    ]);
    expect(destination(null)).toBe('Summary');
    expect(destination('f9')).toBe('Unknown position');
  });

  it('labels a fact from the user’s answer as such', () => {
    const answer = 'I led five people.';
    const text = `${source}\n${answer}`;
    const fact: Fact = {
      id: 'a1',
      kind: 'achievement',
      quote: answer,
      span: [source.length + 1, text.length],
      achievement: { positionId: 'f1' },
    };
    const { evidence } = judgeEvidence([...facts, fact], text, source.length);
    expect(evidence(['a1'])).toEqual([
      { quote: answer, appearsUnder: "the user's answer about Senior Engineer — Acme (? – ?)" },
    ]);
  });

  it('reports the placement as unclear when unrecognized lines lie between the position and the quote', () => {
    // The extractor missed the "Engineer, Globex" heading, so Globex's bullet seems to stand under Acme.
    const { evidence } = judgeEvidence(
      facts.filter((fact) => fact.id !== 'f3'),
      source,
      source.length,
      ['Engineer, Globex'],
    );
    expect(evidence(['f4'])).toEqual([
      {
        quote: 'Built search.',
        appearsUnder:
          'unclear: unrecognized text stands between the nearest position above and this quote',
      },
    ]);
    expect(evidence(['f2'])).toEqual([
      { quote: 'Led billing.', appearsUnder: 'Senior Engineer — Acme (? – ?)' },
    ]);
  });
});
