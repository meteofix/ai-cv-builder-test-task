import { bulletsOf, type CvDocument } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import { withServerProvenance } from './provenance.js';

function stored(): CvDocument {
  return {
    locale: 'en',
    contacts: {
      fullName: 'Iryna Kovalenko',
      email: 'i@example.com',
      phone: '',
      location: '',
      links: [],
    },
    headline: 'Engineer',
    summary: { text: 'Builds things.', factIds: ['f1'] },
    experience: [
      {
        id: 'p1',
        factId: 'f2',
        company: 'Acme',
        title: 'Engineer',
        location: 'Kyiv',
        start: '2021',
        end: null,
        current: true,
        groups: [
          {
            id: 'p1-g1',
            title: null,
            items: [{ id: 'b1', text: 'Led the billing migration.', factIds: ['f3'] }],
          },
          {
            id: 'p1-g2',
            title: 'Tooling',
            items: [{ id: 'b2', text: 'Cut build time.', factIds: ['f4'] }],
          },
        ],
      },
      {
        id: 'p2',
        factId: 'f5',
        company: 'Beta',
        title: 'Intern',
        start: '2019',
        end: '2020',
        current: false,
        groups: [
          {
            id: 'p2-g1',
            title: null,
            items: [{ id: 'b3', text: 'Wrote tests.', factIds: ['f6'] }],
          },
        ],
      },
    ],
    education: [
      { id: 'e1', factId: 'f7', institution: 'KPI', degree: 'BSc', start: '2014', end: '2018' },
    ],
    skills: [{ id: 'g1', title: null, items: [{ id: 's1', factId: 'f8', name: 'TypeScript' }] }],
    additional: [
      {
        id: 'a1',
        title: 'Awards',
        entries: [
          {
            id: 'a1-e1',
            title: 'City hackathon',
            start: '2022',
            end: null,
            groups: [
              {
                id: 'a1-e1-g1',
                title: null,
                items: [{ id: 'i1', text: 'Hackathon winner.', factIds: ['f9'] }],
              },
            ],
          },
          { id: 'a1-e2', title: 'Robotics fair', start: null, end: null, groups: [] },
        ],
      },
    ],
  };
}

/** Applies `change` to a copy of the stored document, as a client edit would, and runs the merge. */
function edit(change?: (draft: CvDocument) => void): CvDocument {
  const draft = structuredClone(stored());
  change?.(draft);
  return withServerProvenance(stored(), draft);
}

describe('withServerProvenance', () => {
  it('leaves an untouched document as it is', () => {
    expect(edit()).toEqual(stored());
  });

  it('ignores the fact ids the client sends', () => {
    const result = edit((draft) => {
      draft.summary.factIds = ['evil'];
      draft.experience[0]!.factId = 'evil';
      draft.experience[0]!.groups[0]!.items[0]!.factIds = ['evil'];
      draft.education[0]!.factId = 'evil';
      draft.skills[0]!.items[0]!.factId = 'evil';
      draft.additional[0]!.entries[0]!.groups[0]!.items[0]!.factIds = ['evil'];
    });
    expect(result).toEqual(stored());
  });

  it.each([
    ['company', (p: CvDocument['experience'][number]) => (p.company = 'Acme Inc')],
    ['title', (p: CvDocument['experience'][number]) => (p.title = 'Staff Engineer')],
    ['location', (p: CvDocument['experience'][number]) => (p.location = 'Lviv')],
    ['start', (p: CvDocument['experience'][number]) => (p.start = '2020')],
    ['end', (p: CvDocument['experience'][number]) => (p.end = '2023')],
    ['current', (p: CvDocument['experience'][number]) => (p.current = false)],
  ])('removes the position fact when %s changes', (_field, change) => {
    const result = edit((draft) => change(draft.experience[0]!));
    expect(result.experience[0]).not.toHaveProperty('factId');
    expect(result.experience[1]?.factId).toBe('f5');
  });

  it('keeps the position fact when only a bullet changes, and drops that bullet’s facts', () => {
    const result = edit((draft) => {
      draft.experience[0]!.groups[0]!.items[0]!.text = 'Led the billing migration to TypeScript.';
    });
    expect(result.experience[0]?.factId).toBe('f2');
    expect(bulletsOf(result.experience[0]!).map((b) => b.factIds)).toEqual([[], ['f4']]);
  });

  it('gives a new bullet no facts, also when it reuses a stored id from another position', () => {
    const result = edit((draft) => {
      draft.experience[1]!.groups[0]!.items.push({
        id: 'b1',
        text: 'Led the billing migration.',
        factIds: [],
      });
    });
    // Same id and text as a bullet of p1, but the segment ids of that job must not follow it to p2.
    expect(bulletsOf(result.experience[1]!).at(-1)?.factIds).toEqual([]);
  });

  it('keeps the facts of a bullet moved to another group of its position', () => {
    const result = edit((draft) => {
      const [first, second] = draft.experience[0]!.groups;
      second!.items.push(first!.items.pop()!);
      second!.title = 'Delivery';
    });
    expect(result.experience[0]?.groups.map((g) => g.items.map((b) => [b.id, b.factIds]))).toEqual([
      [],
      [
        ['b2', ['f4']],
        ['b1', ['f3']],
      ],
    ]);
  });

  it('keeps the facts of an unchanged entry line moved to a new group of its entry', () => {
    const result = edit((draft) => {
      const entry = draft.additional[0]!.entries[0]!;
      entry.groups.push({ id: 'a1-e1-g2', title: 'Prizes', items: entry.groups[0]!.items });
      entry.groups[0]!.items = [];
    });
    expect(result.additional[0]?.entries[0]?.groups[1]?.items[0]?.factIds).toEqual(['f9']);
  });

  it('gives a line moved to another entry no facts', () => {
    const result = edit((draft) => {
      const [first, second] = draft.additional[0]!.entries;
      second!.groups = first!.groups;
      first!.groups = [];
    });
    expect(result.additional[0]?.entries[1]?.groups[0]?.items[0]?.factIds).toEqual([]);
  });

  it('treats an absent optional field and an empty one as equal', () => {
    const result = edit((draft) => {
      draft.experience[1]!.location = '';
    });
    expect(result.experience[1]?.factId).toBe('f5');
  });

  it('keeps the summary facts only while its text is unchanged', () => {
    expect(edit((draft) => (draft.summary.text = 'Builds more things.')).summary.factIds).toEqual(
      [],
    );
    expect(edit().summary.factIds).toEqual(['f1']);
  });

  it.each([
    ['institution', (e: CvDocument['education'][number]) => (e.institution = 'LPNU')],
    ['degree', (e: CvDocument['education'][number]) => (e.degree = 'MSc')],
    ['start', (e: CvDocument['education'][number]) => (e.start = '2013')],
    ['end', (e: CvDocument['education'][number]) => (e.end = '2019')],
  ])('removes the education fact when %s changes', (_field, change) => {
    expect(edit((draft) => change(draft.education[0]!)).education[0]).not.toHaveProperty('factId');
  });

  it('removes the skill fact when the name changes', () => {
    expect(
      edit((draft) => (draft.skills[0]!.items[0]!.name = 'JavaScript')).skills[0]?.items[0],
    ).not.toHaveProperty('factId');
  });

  it('drops the facts of an edited additional item and keeps the rest', () => {
    const result = edit((draft) => {
      const lines = draft.additional[0]!.entries[0]!.groups[0]!.items;
      lines[0]!.text = 'Hackathon finalist.';
      lines.push({ id: 'i2', text: 'New.', factIds: ['f1'] });
    });
    expect(result.additional[0]?.entries[0]?.groups[0]?.items.map((line) => line.factIds)).toEqual([
      [],
      [],
    ]);
  });

  it('treats an item with an unknown id as new', () => {
    const result = edit((draft) => {
      draft.skills[0]!.items.push({ id: 's2', name: 'Rust', factId: 'f1' });
    });
    expect(result.skills[0]?.items[1]).not.toHaveProperty('factId');
  });
});
