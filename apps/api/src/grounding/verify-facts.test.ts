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
});
