import { bulletsOf, LIMITS, type Answer, type CvDocument, type QuestionTarget } from '@cv/shared';
import type { ProseItem } from './schemas.js';
import { summary } from './skeleton.js';

/** Fields a text answer sets directly, without the LLM. */
const DIRECT_FIELDS = ['company', 'title', 'location', 'institution', 'degree'] as const;
export type DirectField = (typeof DIRECT_FIELDS)[number];

export function isDirectField(field: string | undefined): field is DirectField {
  return DIRECT_FIELDS.some((known) => known === field);
}

export const NOTES = {
  gone: 'The part of the CV this answer was for no longer exists.',
  mismatch: 'This answer does not fit the part of the CV it was asked about.',
  partial: 'Some of the new text could not be verified and was left out.',
  nothing: 'None of the new text could be verified, so this part of your CV was left as it was.',
  ownSummary: 'You wrote the summary yourself, so it was left as it was.',
} as const;

export type Patch =
  | { kind: 'dates'; answer: Extract<Answer, { type: 'dates' }> }
  | { kind: 'field'; field: DirectField; value: string }
  | { kind: 'bullets'; bullets: readonly ProseItem[] }
  | { kind: 'summary'; sentences: readonly ProseItem[] };

export type PatchResult =
  | { kind: 'gone' | 'mismatch' }
  /** `document` is the same object when nothing could be applied; `note` explains a partial result. */
  | { kind: 'patched'; document: CvDocument; partial: boolean; note: string | null };

const patched = (document: CvDocument, note: string | null = null): PatchResult => ({
  kind: 'patched',
  document,
  partial: note !== null,
  note,
});

/**
 * The document with only the answer's target changed. Everything else keeps its object, so it stays byte
 * for byte the same. Verified content is never replaced by nothing, and the user's own text stays.
 */
export function applyPatch(
  document: CvDocument,
  target: QuestionTarget,
  patch: Patch,
): PatchResult {
  if (target.section === 'summary') {
    if (patch.kind !== 'summary') return { kind: 'mismatch' };
    // A summary without fact references was written by the user (an edit clears them).
    if (document.summary.factIds.length === 0 && document.summary.text.trim()) {
      return patched(document, NOTES.ownSummary);
    }
    if (patch.sentences.length === 0) return patched(document, NOTES.nothing);
    const next = summary(patch.sentences);
    const cut = next.text.length < patch.sentences.map((s) => s.text).join(' ').length;
    return patched({ ...document, summary: next }, cut ? NOTES.partial : null);
  }

  if (target.section === 'education') {
    const index = document.education.findIndex((item) => item.id === target.itemId);
    const school = document.education[index];
    if (!school) return { kind: 'gone' };
    if (patch.kind === 'dates') {
      const next = { ...school, start: patch.answer.start, end: patch.answer.end };
      return patched({ ...document, education: document.education.with(index, next) });
    }
    if (patch.kind === 'field' && (patch.field === 'institution' || patch.field === 'degree')) {
      const next = { ...school, [patch.field]: patch.value };
      return patched({ ...document, education: document.education.with(index, next) });
    }
    return { kind: 'mismatch' };
  }

  if (target.section === 'additional') return applyToEntry(document, target, patch);

  if (target.section !== 'experience') return { kind: 'mismatch' };
  const index = document.experience.findIndex((item) => item.id === target.itemId);
  const job = document.experience[index];
  if (!job) return { kind: 'gone' };
  const replace = (next: typeof job, note: string | null = null) =>
    patched({ ...document, experience: document.experience.with(index, next) }, note);
  switch (patch.kind) {
    case 'dates':
      return replace({
        ...job,
        start: patch.answer.start,
        end: patch.answer.current ? null : patch.answer.end,
        current: patch.answer.current,
      });
    case 'field':
      if (patch.field === 'institution' || patch.field === 'degree') return { kind: 'mismatch' };
      return replace({ ...job, [patch.field]: patch.value });
    case 'bullets': {
      if (patch.bullets.length === 0) return patched(document, NOTES.nothing);
      // Bullets the user wrote or edited (no factIds) always stay, after the regenerated ones.
      const own = bulletsOf(job).filter((bullet) => bullet.factIds.length === 0);
      const room = Math.max(0, LIMITS.maxBulletsPerPosition - own.length);
      const fresh = patch.bullets.slice(0, room).map(({ id, text, factIds }) => ({
        id,
        text,
        factIds: [...factIds],
      }));
      const note = fresh.length < patch.bullets.length ? NOTES.partial : null;
      // The old answer flow knows no groups; it goes until the new one replaces it (V2-Z3).
      const groups = [{ id: `${job.id}-g1`, title: null, items: [...fresh, ...own] }];
      return replace({ ...job, groups }, note);
    }
    case 'summary':
      return { kind: 'mismatch' };
  }
}

/** The dates or the title of an extra entry; an answer about a whole section has no field to set. */
function applyToEntry(document: CvDocument, target: QuestionTarget, patch: Patch): PatchResult {
  for (const [at, section] of document.additional.entries()) {
    const index = section.entries.findIndex((entry) => entry.id === target.itemId);
    const entry = section.entries[index];
    if (!entry) continue;
    let next: typeof entry;
    if (patch.kind === 'dates') {
      next = {
        ...entry,
        start: patch.answer.start,
        end: patch.answer.current ? null : patch.answer.end,
      };
    } else if (patch.kind === 'field' && patch.field === 'title') {
      next = { ...entry, title: patch.value };
    } else {
      return { kind: 'mismatch' };
    }
    const owner = { ...section, entries: section.entries.with(index, next) };
    return patched({ ...document, additional: document.additional.with(at, owner) });
  }
  return document.additional.some((section) => section.id === target.itemId)
    ? { kind: 'mismatch' }
    : { kind: 'gone' };
}
