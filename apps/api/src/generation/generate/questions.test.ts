import type { CvDocument, CvPosition } from '@cv/shared';
import { describe, expect, it } from 'vitest';
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
      buildQuestions({ source: '', document: document([job('p1')]), facts: [], removed }),
    ).toHaveLength(10);
  });
});
