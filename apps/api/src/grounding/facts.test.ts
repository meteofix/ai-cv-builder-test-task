import { describe, expect, it } from 'vitest';
import { extractedFactSchema, factSchema, type ExtractedFact } from './facts.js';

const ONE_OF_EACH: ExtractedFact[] = [
  { id: 'c', kind: 'contact', quote: 'Iryna', contact: { field: 'fullName', value: 'Iryna' } },
  {
    id: 'p',
    kind: 'position',
    quote: 'Engineer, Acme, 2021',
    vague: true,
    position: {
      company: 'Acme',
      title: 'Engineer',
      location: null,
      start: '2021',
      end: null,
      current: true,
    },
  },
  { id: 'a', kind: 'achievement', quote: 'Led billing', achievement: { positionId: 'p' } },
  {
    id: 'e',
    kind: 'education',
    quote: 'KPI, 2014 – 2018',
    education: { institution: 'KPI', degree: null, start: '2014', end: '2018-06' },
  },
  { id: 's', kind: 'skill', quote: 'Go', skill: { name: 'Go' } },
  { id: 'r', kind: 'profile', quote: 'Calm under pressure' },
  { id: 'o', kind: 'other', quote: 'AWS Certified', other: { section: 'Certifications' } },
];

describe('factSchema', () => {
  it.each(ONE_OF_EACH)('keeps the kind field and the span of a $kind fact', (fact) => {
    const stored = { ...fact, span: [3, 9] };
    expect(factSchema.parse(stored)).toEqual(stored);
  });
});

describe('extractedFactSchema', () => {
  it('rejects a position without position fields', () => {
    expect(extractedFactSchema.safeParse({ id: 'p', kind: 'position', quote: 'x' }).success).toBe(
      false,
    );
  });

  it('strips fields of another kind', () => {
    const parsed = extractedFactSchema.parse({
      id: 'r',
      kind: 'profile',
      quote: 'Calm',
      position: { company: 'Google' },
    });
    expect(parsed).toEqual({ id: 'r', kind: 'profile', quote: 'Calm' });
  });

  it.each(['2021-13', '21', '2021-3', 'present'])('rejects the date %j', (start) => {
    const position = {
      ...ONE_OF_EACH[1],
      position: { ...(ONE_OF_EACH[1] as { position: object }).position, start },
    };
    expect(extractedFactSchema.safeParse(position).success).toBe(false);
  });

  it('accepts a long quote, so one long paragraph cannot fail the extraction', () => {
    const quote = 'About me. '.repeat(400);
    expect(extractedFactSchema.safeParse({ id: 'r', kind: 'profile', quote }).success).toBe(true);
  });
});
