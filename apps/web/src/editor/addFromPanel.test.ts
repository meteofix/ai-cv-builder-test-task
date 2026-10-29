import { bulletsOf, LIMITS, type CvDocument, type NotInCvItem } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import { editorDocument } from '../test/fixtures';
import { addFromPanel, shownInCv } from './addFromPanel';

const item = (overrides: Partial<NotInCvItem>): NotInCvItem => ({
  text: 'Ran the hiring loop.',
  reason: 'not_included',
  ...overrides,
});

const added = (document: CvDocument, entry: NotInCvItem): CvDocument => {
  const next = addFromPanel(document, entry);
  if (!next) throw new Error('nothing was added');
  return next;
};

const line = (id: string, text: string) => ({ id, text, factIds: [] });

/** The fixture with a second extra section: a project with a title, dates and two groups of lines. */
function withProject(): CvDocument {
  const doc = editorDocument();
  return {
    ...doc,
    additional: [
      ...doc.additional,
      {
        id: 'add-2',
        title: 'Projects',
        entries: [
          {
            id: 'add-2-e1',
            title: 'Trail map app',
            start: '2022',
            end: null,
            groups: [
              { id: 'add-2-e1-g1', title: null, items: [line('p-1', 'Offline maps for hikers.')] },
              { id: 'add-2-e1-g2', title: 'Stack', items: [line('p-2', 'Kotlin, SQLite')] },
            ],
          },
        ],
      },
    ],
  };
}

describe('addFromPanel', () => {
  it('adds a sentence to the summary and a line of skills as a group, brackets kept', () => {
    const doc = editorDocument();
    expect(added(doc, item({ section: 'summary' })).summary.text).toBe(
      `${doc.summary.text} Ran the hiring loop.`,
    );
    const skills = added(
      doc,
      item({ section: 'skills', text: 'Go, Python (pandas, NumPy)' }),
    ).skills;
    expect(skills.at(-1)).toMatchObject({
      title: null,
      items: [{ name: 'Go' }, { name: 'Python (pandas, NumPy)' }],
    });
  });

  it('adds skills to their own group, without repeating a name it has', () => {
    const next = added(
      editorDocument(),
      item({ section: 'skills', itemId: 'skg-1', text: 'react, Vue' }),
    );
    expect(next.skills).toHaveLength(1);
    expect(next.skills[0]?.items.map((skill) => skill.name)).toEqual([
      'TypeScript',
      'React',
      'Vue',
    ]);
  });

  it('adds a bullet to the last untitled group of its position, never under a title', () => {
    const doc = editorDocument();
    const [first, second] = doc.experience;
    const grouped: CvDocument = {
      ...doc,
      experience: [
        {
          ...first!,
          groups: [
            { id: 'pos-1-g1', title: 'Platform', items: [line('b-1', 'Built the API.')] },
            { id: 'pos-1-g2', title: 'Team', items: [line('b-2', 'Hired two engineers.')] },
          ],
        },
        { ...second!, groups: [] },
      ],
    };
    // Both groups have a title: the bullet starts a plain group after them.
    const titled = added(grouped, item({ section: 'experience', itemId: 'pos-1' }));
    expect(titled.experience[0]?.groups.map((group) => [group.title, group.items.length])).toEqual([
      ['Platform', 1],
      ['Team', 1],
      [null, 1],
    ]);
    const withPlain: CvDocument = {
      ...grouped,
      experience: grouped.experience.map((position, i) =>
        i === 0
          ? { ...position, groups: [{ ...position.groups[0]!, title: null }, position.groups[1]!] }
          : position,
      ),
    };
    const toPlain = added(withPlain, item({ section: 'experience', itemId: 'pos-1' }));
    expect(toPlain.experience[0]?.groups[0]?.items.at(-1)?.text).toBe('Ran the hiring loop.');
    expect(toPlain.experience[0]?.groups[1]?.items).toHaveLength(1);

    const toNew = added(grouped, item({ section: 'experience', itemId: 'pos-2' }));
    expect(toNew.experience[1]?.groups).toMatchObject([
      { title: null, items: [{ text: 'Ran the hiring loop.' }] },
    ]);
  });

  it('adds a line to the plain list of its own section', () => {
    const next = added(
      editorDocument(),
      item({ section: 'additional', itemId: 'add-1', text: 'Polish — B1' }),
    );
    expect(next.additional[0]?.entries).toHaveLength(1);
    expect(bulletsOf(next.additional[0]!.entries[0]!).map((entry) => entry.text)).toEqual([
      'Ukrainian — native',
      'English — C1',
      'Polish — B1',
    ]);
  });

  it('adds a line to the untitled group of its entry, or a new entry after a titled one', () => {
    const doc = withProject();
    const inEntry = added(doc, item({ section: 'additional', itemId: 'add-2-e1', text: 'Swift' }));
    const groups = inEntry.additional[1]?.entries[0]?.groups;
    expect(groups?.[0]?.items.at(-1)?.text).toBe('Swift');
    // Not under the "Stack" title, which was checked for its own lines.
    expect(groups?.[1]?.items.map((line) => line.text)).not.toContain('Swift');

    const inSection = added(doc, item({ section: 'additional', itemId: 'add-2', text: 'Talk' }));
    expect(inSection.additional[1]?.entries).toHaveLength(2);
    expect(inSection.additional[1]?.entries[1]).toMatchObject({
      title: '',
      start: null,
      end: null,
      groups: [{ title: null, items: [{ text: 'Talk' }] }],
    });
  });

  it.each([
    ['an item without a place', item({})],
    ['an education line', item({ section: 'education' })],
    ['a bullet of a job that is gone', item({ section: 'experience', itemId: 'nope' })],
    ['a line of a section that is gone', item({ section: 'additional', itemId: 'nope' })],
    [
      'a bullet too long for a bullet',
      item({ section: 'experience', itemId: 'pos-1', text: 'x'.repeat(401) }),
    ],
  ])('puts %s into an extra section, in the language of the CV', (_case, entry) => {
    expect(added(editorDocument(), entry).additional.at(-1)).toMatchObject({
      title: 'Additional information',
      entries: [{ title: '', groups: [{ title: null, items: [{ text: entry.text }] }] }],
    });
    expect(added(editorDocument({ locale: 'uk' }), entry).additional.at(-1)?.title).toBe(
      'Додаткова інформація',
    );
  });

  it('keeps a second line without a place in the same list of "Additional information"', () => {
    const once = added(editorDocument(), item({ text: 'Hobbies: sailing' }));
    const twice = added(once, item({ text: 'Driving licence B' }));
    const fallback = twice.additional.at(-1)!;
    expect(fallback.entries).toHaveLength(1);
    expect(bulletsOf(fallback.entries[0]!).map((entry) => entry.text)).toEqual([
      'Hobbies: sailing',
      'Driving licence B',
    ]);
  });

  it('sends a bullet to an extra section when its job is full across its groups', () => {
    const doc = editorDocument();
    const half = LIMITS.maxBulletsPerPosition / 2;
    const bullets = (from: number) =>
      Array.from({ length: half }, (_, i) => line(`b${from + i}`, `Bullet ${from + i}`));
    const crowded = {
      ...doc,
      experience: doc.experience.map((job, i) =>
        i === 0
          ? {
              ...job,
              groups: [
                { id: 'g1', title: 'One', items: bullets(0) },
                { id: 'g2', title: 'Two', items: bullets(half) },
              ],
            }
          : job,
      ),
    };
    const next = added(crowded, item({ section: 'experience', itemId: 'pos-1' }));
    expect(bulletsOf(next.experience[0]!)).toHaveLength(LIMITS.maxBulletsPerPosition);
    expect(bulletsOf(next.additional.at(-1)!.entries.at(-1)!).at(-1)?.text).toBe(
      'Ran the hiring loop.',
    );
  });

  it('adds a bullet of a company block that shares its bullets to the block’s first position', () => {
    const doc = editorDocument();
    const [first, second] = doc.experience;
    const block: CvDocument = {
      ...doc,
      experience: [first!, { ...second!, company: first!.company, groups: [] }],
    };
    const next = added(block, item({ section: 'experience', itemId: second!.id }));
    expect(bulletsOf(next.experience[0]!).at(-1)?.text).toBe('Ran the hiring loop.');
    expect(next.experience[1]?.groups).toEqual([]);
  });

  it('adds nothing when no place is left within the limits, and never ignored text', () => {
    const doc = editorDocument();
    const sections = Array.from({ length: LIMITS.maxAdditionalSections }, (_, i) => ({
      id: `s${i}`,
      title: `Section ${i}`,
      entries: [],
    }));
    expect(addFromPanel({ ...doc, additional: sections }, item({}))).toBeNull();
    expect(addFromPanel(doc, item({ reason: 'ignored', section: 'summary' }))).toBeNull();
  });
});

describe('shownInCv', () => {
  it('knows a bullet, a line, a sentence of the summary and a line of skills the CV shows', () => {
    const doc = editorDocument();
    const bullet = bulletsOf(doc.experience[0]!)[0]?.text ?? '';
    expect(shownInCv(doc, `  ${bullet.toUpperCase()} `)).toBe(true);
    expect(shownInCv(doc, 'English — C1')).toBe(true);
    expect(shownInCv(doc, 'React, TypeScript')).toBe(true);
    expect(shownInCv(doc, 'Ran the hiring loop.')).toBe(false);
  });

  it('knows the title and a line of a later group of an extra entry', () => {
    const doc = withProject();
    expect(shownInCv(doc, 'Trail map app')).toBe(true);
    expect(shownInCv(doc, 'Kotlin, SQLite')).toBe(true);
  });

  it('does not take a short text inside a longer one for shown', () => {
    const doc = editorDocument({
      summary: { text: 'Engineer working with NoSQL stores. Mentors others.', factIds: [] },
    });
    expect(shownInCv(doc, 'SQL')).toBe(false);
    expect(shownInCv(doc, 'Mentors others.')).toBe(true);
  });
});
