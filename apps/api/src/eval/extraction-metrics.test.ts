import { describe, expect, it } from 'vitest';
import { verifyFacts, type ExtractedFact } from '../grounding/index.js';
import { contentLineCount, measureExtraction } from './extraction-metrics.js';

const SOURCE = [
  'Experience',
  'Engineer, Acme Corp, 2021 – 2023',
  '• Shipped the billing service',
  'Skills: Go, SQL',
  'Hobbies: chess',
].join('\n');

const EXTRACTED: ExtractedFact[] = [
  {
    id: 'p',
    kind: 'position',
    quote: 'Engineer, Acme Corp, 2021 – 2023',
    position: {
      company: 'Acme Corp',
      title: 'Engineer',
      location: null,
      start: '2021',
      end: '2023',
      current: false,
    },
  },
  {
    id: 'a',
    kind: 'achievement',
    quote: 'Shipped the billing service',
    achievement: { positionId: 'p' },
  },
  { id: 's', kind: 'skill', quote: 'Go', skill: { name: 'Go' } },
];

describe('contentLineCount', () => {
  it('counts lines with a letter once and leaves out section headings', () => {
    expect(
      contentLineCount('Experience\nAcme\n----\nAcme\n2021\nBuilt things', ['Experience']),
    ).toBe(2);
  });
});

describe('measureExtraction', () => {
  it('counts kinds, pairs positions with the expectation and lists missing contacts', () => {
    const { facts } = verifyFacts(SOURCE, EXTRACTED);
    const metrics = measureExtraction({
      text: SOURCE,
      stored: {
        locale: 'en',
        facts,
        sectionHeadings: ['Experience'],
        instructionSpans: [],
        uncoveredLines: ['Hobbies: chess'],
        answers: [],
      },
      dropped: {},
      expected: {
        positions: [
          { company: 'Acme Corp', title: 'Engineer', start: '2021', end: '2023', bullets: 1 },
        ],
        groupBullets: {},
        skills: 2,
        contacts: ['fullName'],
        education: 0,
        other: 0,
        allowedQuestions: [],
      },
    });
    expect(metrics).toMatchObject({
      kept: 3,
      contentLines: 4,
      uncovered: 1,
      achievements: 1,
      skills: 1,
      contactsMissing: ['fullName'],
      questions: {},
    });
    expect(metrics.matches[0]).toMatchObject({ companyOk: true, titleOk: true, datesOk: true });
    expect(metrics.positions[0]?.bullets).toBe(1);
  });

  it('counts the structural questions the draft would raise', () => {
    const { facts } = verifyFacts(SOURCE, [{ ...EXTRACTED[0]!, quote: 'Engineer' }]);
    const metrics = measureExtraction({
      text: SOURCE,
      stored: {
        locale: 'en',
        facts,
        sectionHeadings: [],
        instructionSpans: [],
        uncoveredLines: [],
        answers: [],
      },
      dropped: {},
      expected: null,
    });
    // The quote holds neither the company nor the years.
    expect(metrics.questions).toEqual({ dates: 1, company: 1 });
  });
});
