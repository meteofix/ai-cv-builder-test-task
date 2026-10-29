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

  it('refuses a skill id used in two groups, and more than 20 groups', () => {
    const group = (id: string, skill: string) => ({
      id,
      title: null,
      items: [{ id: skill, name: 'Go' }],
    });
    expect(
      cvDocumentSchema.safeParse({
        ...emptyDocument,
        skills: [group('g1', 'k1'), group('g2', 'k1')],
      }).success,
    ).toBe(false);
    const many = Array.from({ length: 21 }, (_, i) => group(`g${i}`, `k${i}`));
    expect(cvDocumentSchema.safeParse({ ...emptyDocument, skills: many }).success).toBe(false);
  });

  it('keeps skill groups as they are, and limits the skills of all groups together', () => {
    const groups = [
      { id: 'g1', title: 'Cloud', items: [{ id: 'k1', name: 'AWS' }] },
      { id: 'g2', title: null, items: [{ id: 'k2', name: 'Go' }] },
    ];
    expect(cvDocumentSchema.parse({ ...emptyDocument, skills: groups }).skills).toEqual(groups);
    const many = Array.from({ length: 2 }, (_, g) => ({
      id: `g${g}`,
      title: null,
      items: Array.from({ length: 61 }, (_, i) => ({ id: `k${i}`, name: `Skill ${i}` })),
    }));
    expect(cvDocumentSchema.safeParse({ ...emptyDocument, skills: many }).success).toBe(false);
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
    groups: [
      {
        id: `${id}-g`,
        title: null,
        items: bulletIds.map((bulletId) => ({ id: bulletId, text: 'Did things.', factIds: [] })),
      },
    ],
  });

  it.each([
    ['unique ids', [position('p1', ['b1', 'b2']), position('p2', ['b1'])], true],
    ['two positions with one id', [position('p1', []), position('p1', [])], false],
    ['two bullets with one id in a position', [position('p1', ['b1', 'b1'])], false],
    [
      'one bullet id in two groups of a position',
      [
        {
          ...position('p1', ['b1']),
          groups: [
            ...position('p1', ['b1']).groups,
            { id: 'g2', title: 'More', items: [{ id: 'b1', text: 'x', factIds: [] }] },
          ],
        },
      ],
      false,
    ],
    [
      'more bullets in a position than the limit, across its groups',
      [
        {
          ...position('p1', []),
          groups: Array.from({ length: 3 }, (_, g) => ({
            id: `g${g}`,
            title: `T${g}`,
            items: Array.from({ length: 7 }, (_, i) => ({
              id: `b${g}-${i}`,
              text: 'x',
              factIds: [],
            })),
          })),
        },
      ],
      false,
    ],
  ])('%s → valid: %s', (_case, experience, valid) => {
    const result = cvDocumentSchema.safeParse({ ...emptyDocument, experience });
    expect(result.success).toBe(valid);
  });

  // Lines of an extra entry are capped across its groups like bullets.
  it.each([
    [20, true],
    [21, false],
  ])('an entry with %i lines in three groups → valid: %s', (count, valid) => {
    const items = Array.from({ length: count }, (_, i) => ({
      id: `l${i}`,
      text: 'x',
      factIds: [],
    }));
    const groups = [items.slice(0, 7), items.slice(7, 14), items.slice(14)].map((part, g) => ({
      id: `g${g}`,
      title: null,
      items: part,
    }));
    const entry = { id: 'a1-e1', title: 'Course', start: null, end: null, groups };
    const additional = [{ id: 'a1', title: 'Courses', entries: [entry] }];
    expect(cvDocumentSchema.safeParse({ ...emptyDocument, additional }).success).toBe(valid);
  });

  it('reports where the duplicate is', () => {
    const result = cvDocumentSchema.safeParse({
      ...emptyDocument,
      experience: [position('p1', ['b1', 'b1'])],
    });
    expect(result.error?.issues[0]?.path).toEqual(['experience', 0, 'groups', 0, 'items', 1, 'id']);
  });

  it('rejects a current position with an end date', () => {
    const experience = [{ ...position('p1', []), end: '2023' }];
    expect(cvDocumentSchema.safeParse({ ...emptyDocument, experience }).success).toBe(false);
  });
});

describe('experienceGroups and sharesBullets', () => {
  const job = (company: string, bullets: string[] = []) => ({
    groups: [{ items: bullets.map((text) => ({ text })) }],
    company,
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
