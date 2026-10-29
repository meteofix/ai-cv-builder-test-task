import { describe, expect, it } from 'vitest';
import { verifyFacts } from '../../grounding/index.js';
import { flattenExtraction } from './flatten-extraction.js';
import type { ExperienceGroup } from './schemas.js';

const position = (title: string, quote: string): ExperienceGroup['positions'][number] => ({
  quote,
  title,
  location: null,
  start: null,
  end: null,
  current: false,
});

const GROUP: ExperienceGroup = {
  company: 'Acme Corp',
  companyQuote: 'Acme Corp',
  positions: [position('Lead', 'Lead 2022 – 2024'), position('Engineer', 'Engineer 2019 – 2022')],
  bullets: [
    { quote: 'Shared work', position: null },
    { quote: 'Engineer work', position: 1 },
    { quote: 'Out of range', position: 7 },
  ],
};

describe('flattenExtraction', () => {
  it('gives every position its group company and quote, and every bullet a position id', () => {
    const facts = flattenExtraction({ experience: [GROUP], facts: [] });
    expect(facts.map((fact) => fact.id)).toEqual(['g0p0', 'g0p1', 'g0b0', 'g0b1', 'g0b2']);
    expect(facts[1]).toMatchObject({
      kind: 'position',
      position: { company: 'Acme Corp', companyQuote: 'Acme Corp', title: 'Engineer' },
    });
    const owners = facts.flatMap((fact) =>
      fact.kind === 'achievement' ? [fact.achievement.positionId] : [],
    );
    // Shared and out-of-range bullets go to the group's first position.
    expect(owners).toEqual(['g0p0', 'g0p1', 'g0p0']);
  });

  it('numbers the other kinds and keeps their fields', () => {
    const facts = flattenExtraction({
      experience: [],
      facts: [{ kind: 'skill', quote: 'Go', skill: { name: 'Go' }, vague: true }],
    });
    expect(facts).toEqual([
      { id: 'x0', kind: 'skill', quote: 'Go', skill: { name: 'Go' }, vague: true },
    ]);
  });

  it('points the bullets of a group without positions at a position that does not exist', () => {
    const facts = flattenExtraction({
      experience: [{ ...GROUP, positions: [], bullets: [{ quote: 'Orphan', position: null }] }],
      facts: [],
    });
    expect(facts).toMatchObject([{ kind: 'achievement', achievement: { positionId: 'g0' } }]);
    expect(verifyFacts('Orphan', facts).dropped).toEqual([
      { id: 'g0b0', kind: 'achievement', reason: 'unknown_position' },
    ]);
  });

  it('lets grounding check the company in the group line above the positions', () => {
    const source = 'Acme Corp\nLead 2022 – 2024\nEngineer 2019 – 2022\nShared work';
    const { facts } = verifyFacts(source, flattenExtraction({ experience: [GROUP], facts: [] }));
    const companies = facts.flatMap((fact) =>
      fact.kind === 'position' ? [fact.position.company] : [],
    );
    expect(companies).toEqual(['Acme Corp', 'Acme Corp']);
    expect(facts.some((fact) => fact.kind === 'position' && 'companyQuote' in fact.position)).toBe(
      false,
    );
  });
});
