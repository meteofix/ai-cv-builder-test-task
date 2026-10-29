import { LIMITS, type CvDocument } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import { answerDocument } from '../../../test/generation/answer-fixture.js';
import { applyPatch, EARLIER_REASON, NOTES, positionNow } from './apply-document.js';

const target = { section: 'experience', itemId: 'p1-g1' } as const;
const fresh = (...texts: string[]) => ({
  kind: 'part' as const,
  scope: 'group' as const,
  items: texts.map((text) => ({ text, factIds: ['A1'] })),
  left: 0,
});

/** Job A with `count` more bullets the person wrote in its titled group. */
function withOwnBullets(count: number): CvDocument {
  const document = answerDocument();
  const [jobA, ...rest] = document.experience;
  const [plain, titled] = jobA!.groups;
  const extra = Array.from({ length: count }, (_, i) => ({
    id: `own${i}`,
    text: `Own ${i}`,
    factIds: [],
  }));
  return {
    ...document,
    experience: [
      { ...jobA!, groups: [plain!, { ...titled!, items: [...titled!.items, ...extra] }] },
      ...rest,
    ],
  };
}

describe('applyPatch — a content answer’s part (docs/specs/generation.md §5)', () => {
  it('cuts the new items to the room left when the person added bullets since the write', () => {
    // 1 + 16 bullets in the other group and the person's own one here leave room for 2.
    const document = withOwnBullets(LIMITS.maxBulletsPerPosition - 4);
    const result = applyPatch(document, target, fresh('One', 'Two', 'Three'));
    expect(result).toMatchObject({
      kind: 'patched',
      partial: true,
      note: `${NOTES.partial} ${NOTES.earlier}`,
    });
    if (result.kind !== 'patched') return;
    expect(result.document.experience[0]?.groups[0]?.items.map((item) => item.text)).toEqual([
      'One',
      'Two',
      'Wrote the onboarding guide',
    ]);
  });

  it('changes nothing when a new group would pass the group limit', () => {
    const document = answerDocument();
    const [jobA, ...rest] = document.experience;
    const titled = Array.from({ length: LIMITS.maxGroupsPerList }, (_, g) => ({
      id: `t${g}`,
      title: `T${g}`,
      items: [],
    }));
    const full = { ...document, experience: [{ ...jobA!, groups: titled }, ...rest] };
    const result = applyPatch(full, { section: 'experience', itemId: 'p1' }, fresh('One'));
    expect(result).toEqual({
      kind: 'patched',
      document: full,
      partial: true,
      note: NOTES.nothing,
      dropped: [],
    });
  });

  it('gives new bullets the full stops most bullets of the CV already have', () => {
    const document = answerDocument();
    const stopped: CvDocument = {
      ...document,
      experience: document.experience.map((job) => ({
        ...job,
        groups: job.groups.map((group) => ({
          ...group,
          items: group.items.map((item) => ({ ...item, text: `${item.text}.` })),
        })),
      })),
    };
    const result = applyPatch(stopped, target, fresh('Led billing'));
    if (result.kind !== 'patched') throw new Error(result.kind);
    expect(result.document.experience[0]?.groups[0]?.items[0]?.text).toBe('Led billing.');
    expect(result.document.experience[1]).toBe(stopped.experience[1]);
  });

  it.each([
    [
      0,
      ['Led billing for 3 teams', 'Migrated billing', 'Ran on-call', 'Wrote the onboarding guide'],
    ],
    [
      2,
      ['Migrated billing', 'Ran on-call', 'Led billing for 3 teams', 'Wrote the onboarding guide'],
    ],
    // The group has fewer items than when the question was asked: the end.
    [
      4,
      ['Migrated billing', 'Ran on-call', 'Wrote the onboarding guide', 'Led billing for 3 teams'],
    ],
  ])('puts a one-item answer back at the stored position %i (V2-Q6)', (position, texts) => {
    const result = applyPatch(
      answerDocument(),
      { ...target, position },
      { ...fresh('Led billing for 3 teams'), scope: 'item' },
    );
    if (result.kind !== 'patched') throw new Error(result.kind);
    expect(result.document.experience[0]?.groups[0]?.items.map((item) => item.text)).toEqual(texts);
  });

  /** Job A's first group holding only `texts`, as left after the review took the others out. */
  const leftWith = (...texts: string[]): CvDocument => {
    const document = answerDocument();
    const [jobA, ...rest] = document.experience;
    const [plain, ...others] = jobA!.groups;
    const items = texts.map((text, i) => ({ id: `k${i}`, text, factIds: ['S1'] }));
    return {
      ...document,
      experience: [{ ...jobA!, groups: [{ ...plain!, items }, ...others] }, ...rest],
    };
  };
  const answerAt = (document: CvDocument, text: string, position: number, siblings: number[]) => {
    const questions = siblings.map((at) => ({
      kind: 'unverified',
      target: { ...target, position: at },
      applyStatus: null,
    }));
    const result = applyPatch(document, positionNow({ ...target, position }, questions), {
      ...fresh(text),
      scope: 'item',
    });
    if (result.kind !== 'patched') throw new Error(result.kind);
    return result.document;
  };
  const texts = (document: CvDocument) =>
    document.experience[0]!.groups[0]!.items.map((item) => item.text);

  it.each([
    // [A,B,C] with A and B taken out; [A,B,C,D,E] with B and D taken out; answered in either order.
    [
      'adjacent, first answered first',
      ['C'],
      [
        ['A', 0],
        ['B', 1],
      ],
      ['A', 'B', 'C'],
    ],
    [
      'adjacent, second answered first',
      ['C'],
      [
        ['B', 1],
        ['A', 0],
      ],
      ['A', 'B', 'C'],
    ],
    [
      'apart, first answered first',
      ['A', 'C', 'E'],
      [
        ['B', 1],
        ['D', 3],
      ],
      ['A', 'B', 'C', 'D', 'E'],
    ],
    [
      'apart, second answered first',
      ['A', 'C', 'E'],
      [
        ['D', 3],
        ['B', 1],
      ],
      ['A', 'B', 'C', 'D', 'E'],
    ],
  ] as const)(
    "keeps the review's order when two taken-out items come back (%s)",
    (_, left, answers, expected) => {
      let document = leftWith(...left);
      const open = answers.map(([, at]) => at as number);
      for (const [text, at] of answers) {
        open.splice(open.indexOf(at), 1);
        document = answerAt(document, text, at, open);
      }
      expect(texts(document)).toEqual(expected);
    },
  );

  it('does not count a taken-out item of another group or one already back', () => {
    const other = { kind: 'unverified', target: { ...target, itemId: 'p1-g2', position: 0 } };
    const back = { kind: 'unverified', target: { ...target, position: 0 }, applyStatus: 'applied' };
    expect(positionNow({ ...target, position: 2 }, [other, back])).toEqual({
      ...target,
      position: 2,
    });
  });

  it('puts the item at the end when the group it was asked about is gone', () => {
    const result = applyPatch(
      answerDocument(),
      { section: 'experience', itemId: 'p1-g9', position: 0 },
      { ...fresh('Led billing for 3 teams'), scope: 'item' },
    );
    if (result.kind !== 'patched') throw new Error(result.kind);
    expect(result.document.experience[0]?.groups[0]?.items.at(-1)?.text).toBe(
      'Led billing for 3 teams',
    );
  });

  it('adds a one-item answer after everything the group already shows, changing nothing else', () => {
    const result = applyPatch(answerDocument(), target, {
      ...fresh('Led billing for 3 teams'),
      scope: 'item',
    });
    if (result.kind !== 'patched') throw new Error(result.kind);
    expect(result.document.experience[0]?.groups[0]?.items.map((item) => item.text)).toEqual([
      'Migrated billing',
      'Ran on-call',
      'Wrote the onboarding guide',
      'Led billing for 3 teams',
    ]);
    expect(result).toMatchObject({ partial: false, note: null, dropped: [] });
  });

  it('lists every earlier AI item the part no longer shows word for word; the answer is applied', () => {
    const patch = {
      ...fresh(),
      items: [
        // Cites the segment of "Migrated billing": no proof that it says all of it.
        { text: 'Led the billing migration for 3 teams', factIds: ['S3', 'A1'] },
        { text: 'Ran on-call.', factIds: ['S4'] },
      ],
    };
    const result = applyPatch(answerDocument(), target, patch);
    if (result.kind !== 'patched') throw new Error(result.kind);
    // "Ran on-call" is repeated word for word (a full stop aside), so only the rewritten one is listed.
    expect(result.dropped).toEqual([
      {
        text: 'Migrated billing',
        reason: 'not_included',
        context: EARLIER_REASON,
        section: 'experience',
        itemId: 'p1',
      },
    ]);
    expect(result).toMatchObject({ partial: false, note: NOTES.earlier });
  });

  it('leaves the punctuation of entry lines as written, whatever the bullets do', () => {
    const document = answerDocument();
    const stopped: CvDocument = {
      ...document,
      experience: document.experience.map((job) => ({
        ...job,
        groups: job.groups.map((group) => ({
          ...group,
          items: group.items.map((item) => ({ ...item, text: `${item.text}.` })),
        })),
      })),
    };
    const result = applyPatch(
      stopped,
      { section: 'additional', itemId: 'a1-e1' },
      fresh('Offline maps'),
    );
    if (result.kind !== 'patched') throw new Error(result.kind);
    expect(result.document.additional[0]?.entries[0]?.groups[0]?.items[0]?.text).toBe(
      'Offline maps',
    );
  });

  it('keeps a new item within the segments an item may cite', () => {
    const many = Array.from({ length: LIMITS.maxFactIds + 5 }, (_, i) => `S${i}`);
    const result = applyPatch(answerDocument(), target, {
      ...fresh(),
      scope: 'item',
      items: [{ text: 'Led billing', factIds: many }],
    });
    if (result.kind !== 'patched') throw new Error(result.kind);
    expect(result.document.experience[0]?.groups[0]?.items.at(-1)?.factIds).toHaveLength(
      LIMITS.maxFactIds,
    );
  });

  it('lists the earlier summary when the rewrite does not repeat it word for word', () => {
    const rewrite = (text: string) => {
      const result = applyPatch(
        answerDocument(),
        { section: 'summary' },
        {
          ...fresh(),
          items: [{ text, factIds: ['S2', 'A1'] }],
        },
      );
      if (result.kind !== 'patched') throw new Error(result.kind);
      return result.dropped.map((item) => [item.text, item.context]);
    };
    expect(rewrite('Engineer who leads migrations')).toEqual([]);
    // Kept word for word but split into two sentences: still the same text.
    const split = applyPatch(
      answerDocument(),
      { section: 'summary' },
      {
        ...fresh(),
        items: [
          { text: 'Engineer who leads', factIds: ['S2'] },
          { text: 'migrations.', factIds: ['S2'] },
        ],
      },
    );
    expect(split).toMatchObject({ kind: 'patched', dropped: [] });
    expect(rewrite('Engineer who leads billing migrations for three teams')).toEqual([
      ['Engineer who leads migrations.', EARLIER_REASON],
    ]);
  });

  it('lists a bullet resting on an earlier answer once a rewrite changes its words, whatever it cites', () => {
    const document = answerDocument();
    const [jobA, ...rest] = document.experience;
    const [plain, ...others] = jobA!.groups;
    const fromAnswer = { id: 'ans', text: 'Ran three teams', factIds: ['A1'] };
    const withAnswerBullet: CvDocument = {
      ...document,
      experience: [{ ...jobA!, groups: [{ ...plain!, items: [fromAnswer] }, ...others] }, ...rest],
    };
    const rewrite = (text: string) => {
      const result = applyPatch(withAnswerBullet, target, {
        ...fresh(),
        items: [{ text, factIds: ['A1', 'A2'] }],
      });
      if (result.kind !== 'patched') throw new Error(result.kind);
      return result.dropped.map((item) => item.text);
    };
    expect(rewrite('Ran three teams')).toEqual([]);
    expect(rewrite('Ran three teams of five')).toEqual(['Ran three teams']);
  });
});
