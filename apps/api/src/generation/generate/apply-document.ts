import { randomUUID } from 'node:crypto';
import {
  LIMITS,
  type Answer,
  type CvDocument,
  type NotInCvItem,
  type QuestionTarget,
} from '@cv/shared';
import {
  partGroups,
  partKept,
  partOf,
  partRewritten,
  partRoom,
  type GroupPart,
  type PartItem,
  type Scope,
} from '../compose/answer-part.js';
import { endsWithStop, inStyle } from '../compose/stops.js';

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
  instruction:
    'Your answer read like an instruction to the AI rather than information about you, so it was not used.',
  earlier: 'The earlier wording of this part is in "Not in your CV", where you can add it back.',
} as const;

/** Why an earlier item is in "Not in your CV" after an answer replaced its part. */
export const EARLIER_REASON = 'Earlier wording, replaced when the CV was updated from your answer';

export type Patch =
  | { kind: 'dates'; answer: Extract<Answer, { type: 'dates' }> }
  | { kind: 'field'; field: DirectField; value: string }
  /** The reviewed new items of a content answer's part; `left` is how many the review left out. */
  | { kind: 'part'; scope: Scope; items: readonly PartItem[]; left: number };

export type PatchResult =
  | { kind: 'gone' | 'mismatch' }
  /**
   * `document` is the same object when nothing could be applied; `partial` when new text was left out;
   * `note` says what happened; `dropped` are earlier items the part no longer shows word for word, for
   * "Not in your CV".
   */
  | {
      kind: 'patched';
      document: CvDocument;
      partial: boolean;
      note: string | null;
      dropped: NotInCvItem[];
    };

const patched = (
  document: CvDocument,
  note: string | null = null,
  dropped: NotInCvItem[] = [],
  partial = note !== null,
): PatchResult => ({ kind: 'patched', document, partial, note, dropped });

/**
 * The document with only the answer's target changed. Everything else keeps its object, so it stays byte
 * for byte the same. Reviewed content is never replaced by nothing, and the user's own text stays.
 */
export function applyPatch(
  document: CvDocument,
  target: QuestionTarget,
  patch: Patch,
): PatchResult {
  if (patch.kind === 'part') return applyPart(document, target, patch);
  if (target.section === 'summary') return { kind: 'mismatch' };

  if (target.section === 'education') {
    const index = document.education.findIndex((item) => item.id === target.itemId);
    const school = document.education[index];
    if (!school) return { kind: 'gone' };
    if (patch.kind === 'dates') {
      const next = { ...school, start: patch.answer.start, end: patch.answer.end };
      return patched({ ...document, education: document.education.with(index, next) });
    }
    if (patch.field === 'institution' || patch.field === 'degree') {
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
  const replace = (next: typeof job) =>
    patched({ ...document, experience: document.experience.with(index, next) });
  if (patch.kind === 'dates') {
    return replace({
      ...job,
      start: patch.answer.start,
      end: patch.answer.current ? null : patch.answer.end,
      current: patch.answer.current,
    });
  }
  if (patch.field === 'institution' || patch.field === 'degree') return { kind: 'mismatch' };
  return replace({ ...job, [patch.field]: patch.value });
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

/**
 * A content answer's part rewritten (docs/specs/generation.md §5). One item: it goes back to the place
 * the question stored (`position`), or after everything already there when there is none or the group
 * has fewer items now. A group or the summary: the new items replace those the AI wrote, followed by
 * the person's own; an earlier AI item the new version does not keep word for word goes to "Not in your
 * CV" as earlier wording, so nothing disappears silently. The part is found again in the document as it
 * is now, so an edit made while the models wrote is kept.
 */
function applyPart(
  document: CvDocument,
  target: QuestionTarget,
  patch: Extract<Patch, { kind: 'part' }>,
): PatchResult {
  const part = partOf(document, target, patch.scope);
  if (!part) return { kind: 'gone' };
  // A summary without segments was written by the person (an edit clears them).
  if (part.kind === 'summary' && !document.summary.factIds.length && document.summary.text.trim()) {
    return patched(document, NOTES.ownSummary);
  }
  const groups = part.kind === 'group' ? partGroups(document, part) : [];
  const full =
    part.kind === 'group' && part.group === null && groups.length >= LIMITS.maxGroupsPerList;
  const room = full ? 0 : partRoom(document, part);
  // New bullets follow the ending style the CV already has; the rest of it is not touched.
  const withStop = endsWithStop(document);
  const style = (text: string) =>
    part.kind === 'group' && part.section === 'experience' ? inStyle(text, withStop) : text;
  const fresh = patch.items.slice(0, room).map((item) => ({
    id: randomUUID(),
    text: style(item.text),
    factIds: item.factIds.slice(0, LIMITS.maxFactIds),
  }));
  if (fresh.length === 0) return patched(document, NOTES.nothing);

  const owner =
    part.kind === 'summary'
      ? undefined
      : part.section === 'experience'
        ? document.experience[part.job]?.id
        : document.additional[part.index]?.entries[part.entry]?.id;
  // Citing the same segments is no proof the content stayed (a rewrite can shorten an item), so every
  // earlier item the part no longer shows word for word goes to "Not in your CV" (the owner's decision).
  const same = (a: string, b: string) => inStyle(a, false) === inStyle(b, false);
  // The summary is one earlier text and the new one a few sentences: it is kept when they join into it.
  const keeps = (old: PartItem) =>
    part.kind === 'summary'
      ? same(fresh.map((item) => item.text).join(' '), old.text)
      : fresh.some((item) => same(item.text, old.text));
  const dropped = partRewritten(document, part)
    .filter((old) => !keeps(old))
    .map((old): NotInCvItem => ({
      text: old.text,
      reason: 'not_included',
      context: EARLIER_REASON,
      section: part.kind === 'summary' ? 'summary' : part.section,
      ...(owner ? { itemId: owner } : {}),
    }));
  const partial = patch.left > 0 || fresh.length < patch.items.length;
  const notes = [partial ? NOTES.partial : null, dropped.length > 0 ? NOTES.earlier : null].filter(
    (note) => note !== null,
  );
  const note = notes.length > 0 ? notes.join(' ') : null;

  if (part.kind === 'summary') {
    const all = [...partKept(document, part), ...fresh];
    const text = all.map((item) => item.text).join(' ');
    const factIds = [...new Set(all.flatMap((item) => item.factIds))].slice(0, LIMITS.maxFactIds);
    return patched({ ...document, summary: { text, factIds } }, note, dropped, partial);
  }
  const current = part.group === null ? undefined : groups[part.group];
  const before = current?.items ?? [];
  // A bullet the review took out goes back to its place in the group it was asked about; at the end when
  // that group is gone (the part fell back to another one) or has since lost items.
  const at =
    target.position !== undefined &&
    current?.id === target.itemId &&
    target.position <= before.length
      ? target.position
      : before.length;
  const items =
    part.scope === 'item'
      ? before.toSpliced(at, 0, ...fresh)
      : [...fresh, ...before.filter((item) => item.factIds.length === 0)];
  const next = current
    ? groups.with(part.group ?? 0, { ...current, items })
    : [...groups, { id: randomUUID(), title: null, items }];
  return patched(withGroups(document, part, next), note, dropped, partial);
}

function withGroups(
  document: CvDocument,
  part: GroupPart,
  groups: CvDocument['experience'][number]['groups'],
) {
  if (part.section === 'experience') {
    const job = document.experience[part.job];
    if (!job) return document;
    return { ...document, experience: document.experience.with(part.job, { ...job, groups }) };
  }
  const section = document.additional[part.index];
  const entry = section?.entries[part.entry];
  if (!section || !entry) return document;
  const entries = section.entries.with(part.entry, { ...entry, groups });
  return { ...document, additional: document.additional.with(part.index, { ...section, entries }) };
}

/** A sibling question: another doubtful item of the same review. */
export interface SiblingQuestion {
  kind: string;
  target: QuestionTarget;
  applyStatus?: string | null;
}

/**
 * The target with its position among the items the group holds now: `position` is the item's index as
 * the review saw it, so the earlier items of the same group that are not back yet (asked about and not
 * applied) do not count. Answers can then come in any order and still keep the review's order.
 */
export function positionNow(
  target: QuestionTarget,
  siblings: readonly SiblingQuestion[],
): QuestionTarget {
  const at = target.position;
  if (at === undefined) return target;
  const missing = siblings.filter(
    (other) =>
      other.kind === 'unverified' &&
      other.target.itemId === target.itemId &&
      other.target.position !== undefined &&
      other.target.position < at &&
      other.applyStatus !== 'applied',
  ).length;
  return { ...target, position: at - missing };
}
