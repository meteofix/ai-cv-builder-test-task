import { describe, expect, it, test } from 'vitest';
import { cvDocumentSchema, experienceGroups, linkSchema, sharesBullets } from './index.js';

const emptyDocument = {
  locale: 'en',
  contacts: { fullName: 'Iryna Kovalenko', email: '', phone: '', location: '', links: [] },
  headline: 'Senior Full-Stack Engineer',
  summary: { text: '', factIds: [] },
  experience: [],
  education: [],
  skills: [],
  additional: [],
};

describe('cvDocumentSchema', () => {
  it('accepts a minimal document', () => {
    expect(cvDocumentSchema.safeParse(emptyDocument).success).toBe(true);
  });

  it('rejects an unknown locale', () => {
    expect(cvDocumentSchema.safeParse({ ...emptyDocument, locale: 'de' }).success).toBe(false);
  });

  it.each([
    ['https://github.com/example', true],
    ['mailto:a@example.com', true],
    ['tel:+15550100142', true],
    ['javascript:alert(1)', false],
    ['not a url', false],
  ])('link %s → %s', (value, valid) => {
    expect(linkSchema.safeParse(value).success).toBe(valid);
  });
});

describe('ids and dates inside the document', () => {
  const position = (id: string, bulletIds: string[]) => ({
    id,
    company: 'Acme Corp',
    title: 'Engineer',
    start: '2021',
    end: null,
    current: true,
    bullets: bulletIds.map((bulletId) => ({ id: bulletId, text: 'Did things.', factIds: [] })),
  });

  it.each([
    ['unique ids', [position('p1', ['b1', 'b2']), position('p2', ['b1'])], true],
    ['two positions with one id', [position('p1', []), position('p1', [])], false],
    ['two bullets with one id in a position', [position('p1', ['b1', 'b1'])], false],
  ])('%s → valid: %s', (_case, experience, valid) => {
    const result = cvDocumentSchema.safeParse({ ...emptyDocument, experience });
    expect(result.success).toBe(valid);
  });

  it('reports where the duplicate is', () => {
    const result = cvDocumentSchema.safeParse({
      ...emptyDocument,
      experience: [position('p1', ['b1', 'b1'])],
    });
    expect(result.error?.issues[0]?.path).toEqual(['experience', 0, 'bullets', 1, 'id']);
  });

  it('rejects a current position with an end date', () => {
    const experience = [{ ...position('p1', []), end: '2023' }];
    expect(cvDocumentSchema.safeParse({ ...emptyDocument, experience }).success).toBe(false);
  });
});

describe('experienceGroups and sharesBullets', () => {
  const job = (company: string, bullets: string[] = []) => ({
    company,
    bullets: bullets.map((text) => ({ text })),
  });

  it('groups consecutive positions of one company, ignoring case and spacing', () => {
    const groups = experienceGroups([
      job('Acme'),
      job(' acme '),
      job(''),
      job(''),
      job('Globex'),
      job('Acme'),
    ]);
    expect(groups.map((group) => group.map((position) => position.company))).toEqual([
      ['Acme', ' acme '],
      [''],
      [''],
      ['Globex'],
      ['Acme'],
    ]);
    expect(experienceGroups([])).toEqual([]);
  });

  test.each([
    ['only the first has bullets', [job('A', ['x']), job('A')], true],
    ['a later one has bullets', [job('A'), job('A', ['x'])], false],
    ['two have bullets', [job('A', ['x']), job('A', ['y']), job('A')], false],
    ['a single position', [job('A', ['x'])], false],
    ['blank bullets only', [job('A', [' ']), job('A')], false],
  ])('sharesBullets when %s: %s', (_name, group, shared) => {
    expect(sharesBullets(group)).toBe(shared);
  });
});
