import type { CvDocument, CvPosition } from '@cv/shared';
import { describe, expect, it, test } from 'vitest';
import type { Fact } from '../../grounding/index.js';
import { buildQuestions } from './questions.js';

function job(id: string, overrides: Partial<CvPosition> = {}): CvPosition {
  return {
    id,
    company: 'Acme',
    title: 'Engineer',
    start: '2020',
    end: '2021',
    current: false,
    bullets: [{ id: `${id}-b`, text: 'Shipped.', factIds: [id] }],
    ...overrides,
  };
}

function document(experience: CvPosition[], education: CvDocument['education'] = []): CvDocument {
  return {
    locale: 'en',
    contacts: { fullName: '', email: '', phone: '', location: '', links: [] },
    headline: 'Engineer',
    summary: { text: '', factIds: [] },
    experience,
    education,
    skills: [],
    additional: [],
  };
}

describe('buildQuestions', () => {
  it('asks in priority order: removed prose, dates, names, vague facts, positions without a bullet', () => {
    const vague: Fact = {
      id: 'a1',
      kind: 'achievement',
      quote: 'Did things',
      span: [0, 10],
      vague: true,
      achievement: { positionId: 'p3' },
    };
    const questions = buildQuestions({
      source: 'Did things',
      document: document(
        [job('p1', { start: null }), job('p2', { company: '' }), job('p3', { bullets: [] })],
        [{ id: 'e1', institution: '' }],
      ),
      facts: [vague],
      notCurrent: new Set(),
      removed: [
        {
          itemId: 's1',
          text: 'Visionary leader.',
          positionId: null,
          class: 'invented_trait_or_domain',
        },
      ],
    });
    expect(questions.map((q) => [q.kind, q.target])).toEqual([
      ['unverified', { section: 'summary' }],
      ['missing', { section: 'experience', itemId: 'p1', field: 'dates' }],
      ['missing', { section: 'experience', itemId: 'p2', field: 'company' }],
      ['missing', { section: 'education', itemId: 'e1', field: 'institution' }],
      ['vague', { section: 'experience', itemId: 'p3' }],
      ['missing', { section: 'experience', itemId: 'p3' }],
    ]);
    expect(questions[0]).toMatchObject({ answerType: 'text', context: 'Visionary leader.' });
    expect(questions[1]).toMatchObject({ answerType: 'dates', context: 'Engineer — Acme' });
  });

  it.each([
    ['a start with no end on a past job', { start: '2018-07', end: null, current: false }, true],
    ['no start', { start: null, end: '2020', current: false }, true],
    ['a current job', { start: '2018-07', end: null, current: true }, false],
    ['complete dates', { start: '2018', end: '2020', current: false }, false],
  ])('asks about dates for %s: %s', (_case, dates, asked) => {
    const questions = buildQuestions({
      source: 'Did things',
      document: document([job('p1', dates)]),
      facts: [],
      removed: [],
      notCurrent: new Set(),
    });
    expect(questions.some((q) => q.target.field === 'dates')).toBe(asked);
  });

  it('asks at most 10 questions', () => {
    const removed = Array.from({ length: 12 }, (_, i) => ({
      itemId: `b${i}`,
      text: `Claim ${i}`,
      positionId: 'p1',
      class: 'unsupported_claim' as const,
    }));
    expect(
      buildQuestions({
        source: '',
        document: document([job('p1')]),
        facts: [],
        removed,
        notCurrent: new Set(),
      }),
    ).toHaveLength(10);
  });

  it('asks about the dates of a job the judge did not confirm as current before anything else', () => {
    const removed = Array.from({ length: 12 }, (_, i) => ({
      itemId: `b${i}`,
      text: `Claim ${i}`,
      positionId: 'p1',
      class: 'unsupported_claim' as const,
    }));
    const questions = buildQuestions({
      source: '',
      document: document([job('p1', { start: '2021', end: null, current: false })]),
      facts: [],
      removed,
      notCurrent: new Set(['p1']),
    });
    expect(questions).toHaveLength(10);
    expect(questions[0]).toMatchObject({
      answerType: 'dates',
      target: { section: 'experience', itemId: 'p1', field: 'dates' },
    });
    expect(questions.filter((q) => q.target.field === 'dates')).toHaveLength(1);
  });
});

describe('buildQuestions for positions at one company', () => {
  const ask = (experience: CvPosition[]) =>
    buildQuestions({
      source: '',
      document: document(experience),
      facts: [],
      removed: [],
      notCurrent: new Set(),
    })
      .filter((question) => question.target.field === undefined)
      .map((question) => question.target.itemId);

  it('asks no "no bullets" question for a position whose company block has bullets', () => {
    expect(
      ask([
        job('p1', { company: 'Acme' }),
        job('p2', { company: 'ACME ', bullets: [] }),
        job('p3', { company: 'Globex', bullets: [] }),
      ]),
    ).toEqual(['p3']);
  });

  it('asks for every position of a block without any bullet', () => {
    expect(ask([job('p1', { bullets: [] }), job('p2', { bullets: [] })])).toEqual(['p1', 'p2']);
  });

  test.each([
    ['a later position has bullets', [job('p1', { bullets: [] }), job('p2')], ['p1']],
    [
      'two have bullets and one has none',
      [job('p1'), job('p2'), job('p3', { bullets: [] })],
      ['p3'],
    ],
  ])('asks for the positions without bullets when %s', (_name, experience, asked) => {
    expect(ask(experience)).toEqual(asked);
  });
});
