import { describe, expect, it } from 'vitest';
import { editorDocument } from './../test/fixtures';
import { prepareDocument, serialize } from './prepare';

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
        { id: 's', name: ' ' },
        { id: 't', name: 'TypeScript' },
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
          bullets: [],
        },
      ],
      additional: [
        { id: 'a', title: '', items: [{ id: 'i', text: '', factIds: [] }] },
        { id: 'b', title: 'Languages', items: [{ id: 'j', text: '', factIds: [] }] },
      ],
    });

    const prepared = prepareDocument(doc);

    expect(prepared.contacts.links).toEqual(['https://example.com']);
    expect(prepared.skills.map((skill) => skill.name)).toEqual(['TypeScript']);
    expect(prepared.experience.map((position) => position.id)).toEqual(['pos-1', 'pos-2']);
    expect(prepared.additional.map((section) => section.id)).toEqual(['b']);
    expect(prepared.additional[0]?.items).toEqual([]);
  });

  it('is idempotent', () => {
    const doc = editorDocument({ skills: [{ id: 's', name: '' }] });
    expect(prepareDocument(prepareDocument(doc))).toEqual(prepareDocument(doc));
  });
});
