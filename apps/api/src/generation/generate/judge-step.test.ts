import { describe, expect, it } from 'vitest';
import {
  uncoveredLines,
  verifyFacts,
  type ExtractedFact,
  type Fact,
} from '../../grounding/index.js';
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
    const { destination, evidence } = judgeEvidence(facts, source, source.length, []);
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
    const { evidence } = judgeEvidence([...facts, fact], text, source.length, []);
    expect(evidence(['a1'])).toEqual([
      { quote: answer, appearsUnder: "the user's answer about Senior Engineer — Acme (? – ?)" },
    ]);
  });

  it('passes unrecognized lines between the position and the quote along, keeping the position', () => {
    // The extractor missed the "Engineer, Globex" heading, so Globex's bullet seems to stand under Acme;
    // the judge sees the missed heading and can reject the move.
    const { evidence } = judgeEvidence(
      facts.filter((fact) => fact.id !== 'f3'),
      source,
      source.length,
      ['Engineer, Globex'],
    );
    expect(evidence(['f4'])).toEqual([
      {
        quote: 'Built search.',
        appearsUnder: 'Senior Engineer — Acme (? – ?)',
        unrecognizedBefore: ['Engineer, Globex'],
      },
    ]);
    expect(evidence(['f2'])).toEqual([
      { quote: 'Led billing.', appearsUnder: 'Senior Engineer — Acme (? – ?)' },
    ]);
  });

  it('keeps the position for a quote after a page footer, and shows the footer as it is', () => {
    const paged = 'Senior Engineer, Acme\n- Led billing.\nPage 1\n- Ran on-call.';
    const at = (text: string): [number, number] => [
      paged.indexOf(text),
      paged.indexOf(text) + text.length,
    ];
    const pagedFacts: Fact[] = [
      {
        id: 'f1',
        kind: 'position',
        quote: 'Senior Engineer, Acme',
        span: at('Senior Engineer, Acme'),
        position: {
          company: 'Acme',
          title: 'Senior Engineer',
          location: null,
          start: null,
          end: null,
          current: false,
        },
      },
      {
        id: 'f2',
        kind: 'achievement',
        quote: 'Ran on-call.',
        span: at('Ran on-call.'),
        achievement: { positionId: 'f1' },
      },
    ];
    const { evidence, destination } = judgeEvidence(pagedFacts, paged, paged.length, ['Page 1']);
    expect(destination('f1')).toBe('Senior Engineer — Acme (? – ?)');
    expect(evidence(['f2'])).toEqual([
      {
        quote: 'Ran on-call.',
        appearsUnder: 'Senior Engineer — Acme (? – ?)',
        unrecognizedBefore: ['Page 1'],
      },
    ]);
  });

  it('keeps a missed heading that opens a long gap of unrecognized lines', () => {
    const gap = [
      'Engineer, Globex',
      'Jan 2019 – Dec 2020',
      'Kyiv',
      'Team of eight',
      'Fintech',
      'Remote',
      'Responsibilities:',
    ];
    const long = `Senior Engineer, Acme\n${gap.join('\n')}\n- Built search.`;
    const at = (text: string): [number, number] => [
      long.indexOf(text),
      long.indexOf(text) + text.length,
    ];
    const longFacts: Fact[] = [
      {
        id: 'f1',
        kind: 'position',
        quote: 'Senior Engineer, Acme',
        span: at('Senior Engineer, Acme'),
        position: {
          company: 'Acme',
          title: 'Senior Engineer',
          location: null,
          start: null,
          end: null,
          current: false,
        },
      },
      {
        id: 'f2',
        kind: 'achievement',
        quote: 'Built search.',
        span: at('Built search.'),
        achievement: { positionId: 'f1' },
      },
    ];
    const { evidence } = judgeEvidence(longFacts, long, long.length, gap);
    const [item] = evidence(['f2']);
    expect(item?.unrecognizedBefore?.[0]).toBe('Engineer, Globex');
    expect(item?.unrecognizedBefore?.at(-1)).toBe('Responsibilities:');
    expect(item?.unrecognizedBefore).toHaveLength(6);
  });
});

describe('judgeEvidence for an achievement whose own position was not kept', () => {
  it('shows the judge the line of the dropped job between the new position and the quote', () => {
    const source = [
      'Engineer, Acme Corp, 2019 – 2022',
      'Analyst, Globex, 2016 – 2019',
      'Built the reporting pipeline',
    ].join('\n');
    const job = (id: string, quote: string, company: string): ExtractedFact => ({
      id,
      kind: 'position',
      quote,
      position: {
        company,
        title: quote.split(',')[0] ?? '',
        location: null,
        start: null,
        end: null,
        current: false,
      },
    });
    const { facts } = verifyFacts(source, [
      job('acme', 'Engineer, Acme Corp, 2019 – 2022', 'Acme Corp'),
      job('globex', 'Analyst at Globex, 2016 – 2019', 'Globex'),
      {
        id: 'b',
        kind: 'achievement',
        quote: 'Built the reporting pipeline',
        achievement: { positionId: 'globex' },
      },
    ]);
    const bullet = facts.find((fact) => fact.kind === 'achievement');
    expect(bullet).toMatchObject({ achievement: { positionId: 'f1' } });
    const uncovered = uncoveredLines(
      source,
      facts.map((fact) => fact.span),
      [],
    );
    const [evidence] = judgeEvidence(facts, source, source.length, uncovered).evidence([
      bullet!.id,
    ]);
    expect(evidence).toMatchObject({
      appearsUnder: 'Engineer — Acme Corp (? – ?)',
      unrecognizedBefore: ['Analyst, Globex, 2016 – 2019'],
    });
  });
});

describe('judgeEvidence for positions at one company', () => {
  it('lets a quote under any position of the block stand under the destination', () => {
    const source = [
      'Acme Corp',
      'Lead, 2022 – 2024',
      'Engineer, 2019 – 2022',
      'Shipped the billing service',
      'Globex',
      'Analyst, 2016 – 2019',
      'Built reports',
    ].join('\n');
    const at = (text: string): [number, number] => [
      source.indexOf(text),
      source.indexOf(text) + text.length,
    ];
    const position = (id: string, quote: string, company: string): Fact => ({
      id,
      kind: 'position',
      quote,
      span: at(quote),
      position: {
        company,
        title: quote.split(',')[0] ?? '',
        location: null,
        start: null,
        end: null,
        current: false,
      },
    });
    const facts: Fact[] = [
      position('f1', 'Lead, 2022 – 2024', 'Acme Corp'),
      position('f2', 'Engineer, 2019 – 2022', 'Acme Corp'),
      {
        id: 'f3',
        kind: 'achievement',
        quote: 'Shipped the billing service',
        span: at('Shipped the billing service'),
        achievement: { positionId: 'f1' },
      },
      position('f4', 'Analyst, 2016 – 2019', 'Globex'),
      {
        id: 'f5',
        kind: 'achievement',
        quote: 'Built reports',
        span: at('Built reports'),
        achievement: { positionId: 'f4' },
      },
    ];
    const { evidence } = judgeEvidence(facts, source, source.length, []);
    expect(evidence(['f3'], 'f1')[0]?.appearsUnder).toBe('Lead — Acme Corp (? – ?)');
    // Another company is never the same block.
    expect(evidence(['f5'], 'f1')[0]?.appearsUnder).toBe('Analyst — Globex (? – ?)');
    expect(evidence(['f3'])[0]?.appearsUnder).toBe('Engineer — Acme Corp (? – ?)');
  });
});

describe('judgeEvidence: only stacked titles share the bullets below them', () => {
  const source = [
    'Acme Corp',
    'Lead, 2022 – 2024',
    'Led the team',
    'Engineer, 2019 – 2022',
    'Wrote the API',
  ].join('\n');
  const at = (text: string): [number, number] => [
    source.indexOf(text),
    source.indexOf(text) + text.length,
  ];
  const facts: Fact[] = [
    {
      id: 'f1',
      kind: 'position',
      quote: 'Lead, 2022 – 2024',
      span: at('Lead, 2022 – 2024'),
      position: {
        company: 'Acme Corp',
        title: 'Lead',
        location: null,
        start: '2022',
        end: '2024',
        current: false,
      },
    },
    {
      id: 'f2',
      kind: 'achievement',
      quote: 'Led the team',
      span: at('Led the team'),
      achievement: { positionId: 'f1' },
    },
    {
      id: 'f3',
      kind: 'position',
      quote: 'Engineer, 2019 – 2022',
      span: at('Engineer, 2019 – 2022'),
      position: {
        company: 'Acme Corp',
        title: 'Engineer',
        location: null,
        start: '2019',
        end: '2022',
        current: false,
      },
    },
    {
      id: 'f4',
      kind: 'achievement',
      quote: 'Wrote the API',
      span: at('Wrote the API'),
      achievement: { positionId: 'f3' },
    },
  ];

  it('keeps where a quote stands when each title has bullets of its own', () => {
    const { evidence } = judgeEvidence(facts, source, source.length, []);
    expect(evidence(['f4'], 'f1')[0]?.appearsUnder).toBe('Engineer — Acme Corp (2019 – 2022)');
    expect(evidence(['f2'], 'f3')[0]?.appearsUnder).toBe('Lead — Acme Corp (2022 – 2024)');
  });
});

describe('judgeEvidence: a line nobody recognized between two titles', () => {
  it('keeps the literal placement, as for a bullet there', () => {
    const source = [
      'Lead, 2022 – 2024',
      'Ran the platform team',
      'Engineer, 2019 – 2022',
      'Wrote the API',
    ].join('\n');
    const at = (text: string): [number, number] => [
      source.indexOf(text),
      source.indexOf(text) + text.length,
    ];
    const job = (id: string, quote: string, title: string): Fact => ({
      id,
      kind: 'position',
      quote,
      span: at(quote),
      position: {
        company: 'Acme Corp',
        title,
        location: null,
        start: null,
        end: null,
        current: false,
      },
    });
    const facts: Fact[] = [
      job('f1', 'Lead, 2022 – 2024', 'Lead'),
      job('f2', 'Engineer, 2019 – 2022', 'Engineer'),
      {
        id: 'f3',
        kind: 'achievement',
        quote: 'Wrote the API',
        span: at('Wrote the API'),
        achievement: { positionId: 'f2' },
      },
    ];
    const { evidence } = judgeEvidence(facts, source, source.length, ['Ran the platform team']);
    expect(evidence(['f3'], 'f1')[0]?.appearsUnder).toBe('Engineer — Acme Corp (? – ?)');
    // Recognized as nothing, it does not fold; with the line covered the titles would be stacked.
    expect(
      judgeEvidence(facts, source, source.length, []).evidence(['f3'], 'f1')[0]?.appearsUnder,
    ).toBe('Lead — Acme Corp (? – ?)');
  });
});
