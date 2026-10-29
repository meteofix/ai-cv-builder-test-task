import { cvDocumentSchema } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import {
  authorAnswer,
  groupedAnswer,
  SOURCE_WITH_PROJECTS,
} from '../../../test/generation/compose-fixture.js';
import type { AuthorOutput } from './author-schema.js';
import { prepareSource } from './compose.js';
import { buildDraft, toDocument } from './draft.js';

const ROLE = 'Senior Backend Engineer';
const source = prepareSource(SOURCE_WITH_PROJECTS);
const draftOf = (answer: AuthorOutput) => buildDraft(answer, source.index, source.text, ROLE);

/** Groups as `[id, title, item ids]`, the parts the ids and the titles are about. */
const shape = (groups: readonly { id: string; title: string | null; items: { id: string }[] }[]) =>
  groups.map((group) => [group.id, group.title, group.items.map((item) => item.id)]);

describe('toDocument — groups and entries', () => {
  it('numbers the bullets of a position across its groups, so a bullet keeps its id in any group', () => {
    const document = toDocument(draftOf(groupedAnswer()));
    expect(cvDocumentSchema.safeParse(document).success).toBe(true);
    expect(shape(document.experience[0]!.groups)).toEqual([
      ['p1-g1', 'Delivery', ['p1-b1']],
      ['p1-g2', null, ['p1-b2']],
    ]);
  });

  it('gives an entry, its groups and its lines ids under the section', () => {
    const [section] = toDocument(draftOf(groupedAnswer())).additional;
    expect(section).toMatchObject({ id: 'a1', title: 'Projects' });
    expect(section?.entries[0]).toMatchObject({
      id: 'a1-e1',
      title: 'Proofing Timer',
      start: '2022',
      end: '2023',
    });
    expect(shape(section!.entries[0]!.groups)).toEqual([
      ['a1-e1-g1', 'What it does', ['a1-e1-i1']],
    ]);
    expect(section?.entries[0]?.groups[0]?.items[0]).toMatchObject({
      text: 'Reminds a baker when to feed the starter',
      factIds: ['S18'],
    });
  });

  it('drops a group the review left empty and keeps the others', () => {
    const draft = draftOf(groupedAnswer());
    draft.experience[0]!.groups[0]!.items[0]!.removed = true;
    const [position] = toDocument(draft).experience;
    expect(position?.groups.map((group) => [group.title, group.items.map((b) => b.text)])).toEqual([
      [null, ['Mentored two junior developers']],
    ]);
  });

  it.each([
    ['an entry with neither a title nor lines is dropped', '', [], []],
    [
      'an entry with a title alone stays',
      'Food Safety Certificate',
      [],
      ['Food Safety Certificate'],
    ],
    [
      'an entry with lines and no title stays',
      '',
      [{ title: '', items: [{ text: '', segments: ['S18'] }] }],
      [''],
    ],
  ])('%s', (_case, title, groups, titles) => {
    const answer = authorAnswer({
      additional: [
        {
          title: 'Projects',
          entries: [{ title, start: '', end: '', segments: ['S17'], groups }],
        },
      ],
    });
    const additional = toDocument(draftOf(answer)).additional;
    expect(additional.flatMap((section) => section.entries.map((entry) => entry.title))).toEqual(
      titles,
    );
  });

  it.each([
    ['Delivery:', 'Delivery'],
    ['Delivery ::', 'Delivery'],
    ['  Delivery  ', 'Delivery'],
    [' : ', null],
    ['', null],
  ])('stores the group title %j as %j: the template adds the colon', (title, expected) => {
    const answer = groupedAnswer();
    answer.experience[0]!.groups[0]!.title = title;
    expect(toDocument(draftOf(answer)).experience[0]?.groups[0]?.title).toBe(expected);
  });
});
