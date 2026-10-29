import { LIMITS, type CvDocument } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import { answerDocument } from '../../../test/generation/answer-fixture.js';
import { applyPatch, DROPPED_REASON, NOTES } from './apply-document.js';

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
      note: `${NOTES.partial} ${NOTES.dropped}`,
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

  it('puts an earlier AI item no new item carries into "Not in your CV", as a partial result', () => {
    const patch = {
      ...fresh(),
      items: [
        { text: 'Led the billing migration for 3 teams', factIds: ['S3', 'A1'] },
        { text: 'Mentored on-call newcomers', factIds: ['A1'] },
      ],
    };
    const result = applyPatch(answerDocument(), target, patch);
    if (result.kind !== 'patched') throw new Error(result.kind);
    // "Migrated billing" (S3) is carried by the first new item; "Ran on-call" (S4) is not.
    expect(result.dropped).toEqual([
      {
        text: 'Ran on-call',
        reason: 'not_included',
        context: DROPPED_REASON,
        section: 'experience',
        itemId: 'p1',
      },
    ]);
    expect(result).toMatchObject({ partial: true, note: NOTES.dropped });
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

  it('counts a rewritten summary as carried when its sentences together cite the old one', () => {
    const patch = {
      ...fresh(),
      items: [
        { text: 'Engineer who leads migrations', factIds: ['S2', 'A1'] },
        { text: 'Moved billing for three teams', factIds: ['S3', 'A1'] },
      ],
    };
    const result = applyPatch(answerDocument(), { section: 'summary' }, patch);
    expect(result).toMatchObject({ kind: 'patched', partial: false, note: null, dropped: [] });
  });

  it('carries a bullet resting on an earlier answer by a rewrite that cites that answer', () => {
    const document = answerDocument();
    const [jobA, ...rest] = document.experience;
    const [plain, ...others] = jobA!.groups;
    const fromAnswer = { id: 'ans', text: 'Ran three teams', factIds: ['A1'] };
    const withAnswerBullet: CvDocument = {
      ...document,
      experience: [{ ...jobA!, groups: [{ ...plain!, items: [fromAnswer] }, ...others] }, ...rest],
    };
    const rewrite = (factIds: string[]) => {
      const result = applyPatch(withAnswerBullet, target, {
        ...fresh(),
        items: [{ text: 'Ran three teams of five', factIds }],
      });
      if (result.kind !== 'patched') throw new Error(result.kind);
      return result.dropped.map((item) => item.text);
    };
    expect(rewrite(['A1', 'A2'])).toEqual([]);
    expect(rewrite(['A2'])).toEqual(['Ran three teams']);
  });
});
