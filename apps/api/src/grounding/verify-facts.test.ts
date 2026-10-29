import { describe, expect, it } from 'vitest';
import type { ExtractedFact } from './facts.js';
import { verifyFacts } from './verify-facts.js';

const SOURCE = `Iryna Kovalenko
iryna@example.com
Senior Engineer, Acme Corp, 2021 – present
- Led the billing migration.
Kyiv Polytechnic Institute, BSc Computer Science, 2014 – 2018
TypeScript, React`;

const position: ExtractedFact = {
  id: 'pos',
  kind: 'position',
  quote: 'Senior Engineer, Acme Corp, 2021 – present',
  position: {
    company: 'Acme Corp',
    title: 'Senior Engineer',
    location: null,
    start: '2021',
    end: null,
    current: true,
  },
};
const achievement: ExtractedFact = {
  id: 'ach',
  kind: 'achievement',
  quote: 'Led the billing migration.',
  achievement: { positionId: 'pos' },
};

describe('verifyFacts', () => {
  it('renumbers kept facts f1…fn in source order and rewrites position references', () => {
    const { facts } = verifyFacts(SOURCE, [
      { id: 'skill', kind: 'skill', quote: 'TypeScript, React', skill: { name: 'React' } },
      achievement,
      position,
      {
        id: 'name',
        kind: 'contact',
        quote: 'Iryna Kovalenko',
        contact: { field: 'fullName', value: 'Iryna Kovalenko' },
      },
    ]);
    expect(facts.map((fact) => [fact.id, fact.kind])).toEqual([
      ['f1', 'contact'],
      ['f2', 'position'],
      ['f3', 'achievement'],
      ['f4', 'skill'],
    ]);
    expect(facts[2]).toMatchObject({ achievement: { positionId: 'f2' } });
    expect(SOURCE.slice(...facts[1]!.span)).toBe(position.quote);
  });

  it('keeps the first of two facts with the same id', () => {
    const { facts, dropped } = verifyFacts(SOURCE, [position, { ...achievement, id: 'pos' }]);
    expect(facts.map((fact) => fact.kind)).toEqual(['position']);
    expect(dropped).toEqual([{ id: 'pos', kind: 'achievement', reason: 'duplicate_id' }]);
  });

  it('lets a located fact keep an id that an invented fact used first', () => {
    const invented = { ...position, quote: 'Staff Engineer, Google' };
    const { facts, dropped } = verifyFacts(SOURCE, [invented, position]);
    expect(facts.map((fact) => fact.kind)).toEqual(['position']);
    expect(dropped).toEqual([{ id: 'pos', kind: 'position', reason: 'quote_not_found' }]);
  });

  it('drops an achievement of an unknown or dropped position', () => {
    const invented = { ...position, quote: 'Staff Engineer, Google' };
    const { facts, dropped } = verifyFacts(SOURCE, [invented, achievement]);
    expect(facts).toEqual([]);
    expect(dropped).toEqual([
      { id: 'pos', kind: 'position', reason: 'quote_not_found' },
      { id: 'ach', kind: 'achievement', reason: 'unknown_position' },
    ]);
  });

  it('drops a contact whose value is not in its quote', () => {
    const { dropped } = verifyFacts(SOURCE, [
      {
        id: 'c',
        kind: 'contact',
        quote: 'iryna@example.com',
        contact: { field: 'phone', value: '+380 50 123 4567' },
      },
    ]);
    expect(dropped).toEqual([{ id: 'c', kind: 'contact', reason: 'field_not_in_quote' }]);
  });

  it('clears education values and dates that are not in the quote', () => {
    const { facts } = verifyFacts(SOURCE, [
      {
        id: 'e',
        kind: 'education',
        quote: 'Kyiv Polytechnic Institute, BSc Computer Science, 2014 – 2018',
        education: {
          institution: 'Kyiv Polytechnic Institute',
          degree: 'MSc',
          start: '2014-09',
          end: '2019',
        },
      },
    ]);
    expect(facts[0]).toMatchObject({
      education: {
        institution: 'Kyiv Polytechnic Institute',
        degree: null,
        start: '2014-09',
        end: null,
      },
    });
  });

  it('removes a fact overlapping an instruction span and keeps the others', () => {
    const lineStart = SOURCE.indexOf('- Led');
    const { facts, dropped } = verifyFacts(
      SOURCE,
      [position, achievement],
      [[lineStart, lineStart + 5]],
    );
    expect(facts.map((fact) => fact.kind)).toEqual(['position']);
    expect(dropped).toEqual([{ id: 'ach', kind: 'achievement', reason: 'instruction' }]);
  });

  it.each([
    [
      'a URL',
      'link',
      'https://ab.example.com',
      'Site: https://a-b.example.com',
      'https://a-b.example.com',
    ],
    [
      'an e-mail',
      'email',
      'iryna.k@example.com',
      'Mail: iryna-k@example.com',
      'iryna-k@example.com',
    ],
    ['a name in other case', 'fullName', 'IRYNA KOVALENKO', 'Iryna Kovalenko', 'Iryna Kovalenko'],
  ] as const)(
    'stores %s as written in the source, not as the model spelled it',
    (_case, field, value, quote, stored) => {
      const { facts } = verifyFacts(quote, [
        { id: 'c', kind: 'contact', quote, contact: { field, value } },
      ]);
      expect(facts[0]).toMatchObject({ contact: { field, value: stored } });
    },
  );

  it('stores company and skill names as written in the source', () => {
    const quote = 'Engineer, ACME Corp., Node.js';
    const { facts } = verifyFacts(quote, [
      {
        id: 'p',
        kind: 'position',
        quote,
        position: {
          company: 'Acme Corp',
          title: 'engineer',
          location: null,
          start: null,
          end: null,
          current: false,
        },
      },
      { id: 's', kind: 'skill', quote, skill: { name: 'nodejs' } },
    ]);
    expect(
      facts.map((fact) =>
        fact.kind === 'position'
          ? fact.position.company
          : fact.kind === 'skill'
            ? fact.skill.name
            : null,
      ),
    ).toEqual(['ACME Corp', 'Node.js']);
  });

  it.each([
    [
      'a verified end date wins over "current"',
      'Engineer, Acme, 2020 - 2021',
      '2021',
      { end: '2021', current: false },
    ],
    [
      '"current" stays without an end date',
      'Engineer, Acme, 2020 - present',
      null,
      { end: null, current: true },
    ],
    [
      'an end date not in the quote does not cancel "current"',
      'Engineer, Acme, 2020 - present',
      '2023',
      { end: null, current: true },
    ],
  ])('%s', (_case, quote, end, expected) => {
    const { facts } = verifyFacts(quote, [
      {
        id: 'p',
        kind: 'position',
        quote,
        position: {
          company: 'Acme',
          title: 'Engineer',
          location: null,
          start: '2020',
          end,
          current: true,
        },
      },
    ]);
    expect(facts[0]).toMatchObject({ position: expected });
  });

  it.each([
    ['Tel: +380 50 123 45 67', '+380501234567', '+380 50 123 45 67'],
    ['Phone (050) 123-45-67', '0501234567', '(050) 123-45-67'],
  ])('keeps the signs written around a phone number in %j', (quote, value, stored) => {
    const { facts } = verifyFacts(quote, [
      { id: 'c', kind: 'contact', quote, contact: { field: 'phone', value } },
    ]);
    expect(facts[0]).toMatchObject({ contact: { value: stored } });
  });

  it('treats an end year equal to the start year on a current job as ambiguous', () => {
    const quote = 'Engineer, Acme, 2020 – present';
    const { facts } = verifyFacts(quote, [
      {
        id: 'p',
        kind: 'position',
        quote,
        position: {
          company: 'Acme',
          title: 'Engineer',
          location: null,
          start: '2020',
          end: '2020',
          current: true,
        },
      },
    ]);
    expect(facts[0]).toMatchObject({ position: { start: '2020', end: null, current: false } });
  });

  it('stores the quote as the source text, not the model’s copy of it', () => {
    const source = 'Cut   costs by 1,140%.';
    const { facts } = verifyFacts(source, [
      { id: 'r', kind: 'profile', quote: 'cut costs by 1140' },
    ]);
    expect(facts[0]?.quote).toBe('Cut costs by 1,140');
  });
});
