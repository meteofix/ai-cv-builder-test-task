import { describe, expect, it } from 'vitest';
import type { AuthorOutput } from '../generation/compose/author-schema.js';
import { prepareSource } from '../generation/compose/compose.js';
import { applyPlants, candidates, score } from './reviewer-test.js';

const source = prepareSource(
  [
    'Dana Reyes',
    'Analyst at Corvid Labs, 2020 – 2023',
    'Helped build the weekly sales report',
    'Cleaned about 40 data feeds',
  ].join('\n'),
);

const answer: AuthorOutput = {
  locale: 'en',
  contacts: [{ field: 'fullName', value: 'Dana Reyes', segment: 'S1' }],
  headline: { text: '', segments: ['S1'] },
  summary: [],
  experience: [
    {
      title: 'Analyst',
      company: 'Corvid Labs',
      location: '',
      start: '2020',
      end: '2023',
      current: false,
      segments: ['S2'],
      groups: [
        {
          title: '',
          items: [
            { text: '', segments: ['S3'] },
            { text: '', segments: ['S4'] },
          ],
        },
      ],
    },
  ],
  education: [],
  skills: [],
  additional: [],
  notIncluded: [],
  headings: [],
  gaps: [],
  orderReason: '',
  structureNotes: '',
};

describe('reviewer test', () => {
  it('offers the text items under the ids the reviewer uses', () => {
    expect(candidates(answer, source).map(({ id, text }) => [id, text])).toEqual([
      ['job.1.1', 'Helped build the weekly sales report'],
      ['job.1.2', 'Cleaned about 40 data feeds'],
    ]);
  });

  it('applies one plant per kind and item and drops the ones that test nothing', () => {
    const { answer: planted, planted: list } = applyPlants(answer, source, [
      { kind: 'verb_inflation', item: 'job.1.1', text: 'Led the weekly sales report' },
      { kind: 'verb_inflation', item: 'job.1.2', text: 'Owned 40 data feeds' },
      { kind: 'qualifier_dropped', item: 'job.1.1', text: 'Helped build the report' },
      { kind: 'unit_changed', item: 'job.9.9', text: 'Cleaned 40 data teams' },
      { kind: 'year_shift', item: 'job.1.2', text: 'Cleaned about 40 data feeds' },
    ]);
    expect(list.map((plant) => [plant.kind, plant.item])).toEqual([['verb_inflation', 'job.1.1']]);
    expect(planted.experience[0]?.groups[0]?.items[0]?.text).toBe('Led the weekly sales report');
    expect(answer.experience[0]?.groups[0]?.items[0]?.text).toBe('');
  });

  it('scores a plant as caught when the review names its item', () => {
    const { planted } = applyPlants(answer, source, [
      { kind: 'verb_inflation', item: 'job.1.1', text: 'Led the weekly sales report' },
      { kind: 'qualifier_dropped', item: 'job.1.2', text: 'Cleaned 40 data feeds' },
    ]);
    const issue = (item: string) => ({
      item,
      action: 'fix' as const,
      class: 'inflated_scope' as const,
      text: 'x',
      segments: ['S3'],
      question: null,
    });
    const result = score({ issues: [issue('job.1.1'), issue('summary.1')] }, planted);
    expect(result.caught.map((plant) => plant.kind)).toEqual(['verb_inflation']);
    expect(result.missed.map((plant) => plant.kind)).toEqual(['qualifier_dropped']);
    expect(result.others.map((other) => other.item)).toEqual(['summary.1']);
  });
});
