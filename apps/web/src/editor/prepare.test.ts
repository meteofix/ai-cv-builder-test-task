import { describe, expect, it } from 'vitest';
import { editorDocument } from './../test/fixtures';
import { prepareDocument, serialize } from './prepare';

const line = (id: string, text: string) => ({ id, text, factIds: [] });
const group = (id: string, title: string | null, items: ReturnType<typeof line>[]) => ({
  id,
  title,
  items,
});
const entry = (id: string, title: string, groups: ReturnType<typeof group>[]) => ({
  id,
  title,
  start: null,
  end: null,
  groups,
});

describe('prepareDocument', () => {
  it('leaves an untouched server document as the form would give it back', () => {
    // The form registers every input: a position without `location` comes back with '', an education entry
    // without a degree or dates with ''/null. None of that may make an untouched CV look edited.
    const stored = editorDocument();
    const [first, second] = stored.experience;
    const asTheFormHoldsIt = {
      ...stored,
      experience: [first!, { ...second!, location: '' }],
    };
    const bare = {
      ...stored,
      education: [{ id: 'edu-1', institution: 'State University of Technology' }],
    };
    const bareForm = {
      ...bare,
      education: [{ id: 'edu-1', institution: 'State University of Technology', degree: '' }],
    };

    expect(serialize(asTheFormHoldsIt)).toBe(serialize(stored));
    expect(serialize(bareForm)).toBe(serialize(bare));
  });

  it('drops the rows that have no content yet', () => {
    const doc = editorDocument({
      contacts: { ...editorDocument().contacts, links: ['', '  ', 'https://example.com'] },
      skills: [
        {
          id: 'g',
          title: ' ',
          items: [
            { id: 's', name: ' ' },
            { id: 't', name: 'TypeScript' },
          ],
        },
        { id: 'empty', title: 'Cloud', items: [{ id: 'u', name: '' }] },
      ],
      experience: [
        ...editorDocument().experience,
        {
          id: 'new',
          company: '',
          title: '',
          location: '',
          start: null,
          end: null,
          current: false,
          groups: [{ id: 'new-g', title: null, items: [line('new-b', ' ')] }],
        },
      ],
      additional: [
        { id: 'a', title: '', entries: [entry('a-e', '', [group('a-g', null, [line('i', '')])])] },
        {
          id: 'b',
          title: 'Projects',
          entries: [
            entry('b-e1', '', [group('b-g', 'Stack', [line('j', '')])]),
            entry('b-e2', 'Course planner', [
              group('b-g2', '  ', [line('k', 'A planner for study groups.'), line('m', '')]),
            ]),
          ],
        },
      ],
    });

    const prepared = prepareDocument(doc);

    expect(prepared.contacts.links).toEqual(['https://example.com']);
    // A blank title is no title; a group with no skill left is not saved.
    expect(prepared.skills).toEqual([
      { id: 'g', title: null, items: [{ id: 't', name: 'TypeScript' }] },
    ]);
    expect(prepared.experience.map((position) => position.id)).toEqual(['pos-1', 'pos-2']);
    // A group without text goes, and so does an entry left with nothing; a blank group title is none.
    expect(prepared.additional.map((section) => section.id)).toEqual(['b']);
    expect(prepared.additional[0]?.entries).toEqual([
      entry('b-e2', 'Course planner', [
        group('b-g2', null, [line('k', 'A planner for study groups.')]),
      ]),
    ]);
  });

  it('is idempotent', () => {
    const doc = editorDocument({
      skills: [{ id: 'g', title: null, items: [{ id: 's', name: '' }] }],
      additional: [
        {
          id: 'a',
          title: 'Projects',
          entries: [entry('e', '', [group('g', ' ', [line('l', 'x')])])],
        },
      ],
    });
    expect(prepareDocument(prepareDocument(doc))).toEqual(prepareDocument(doc));
  });
});
