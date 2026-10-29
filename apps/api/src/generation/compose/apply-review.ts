import { splitSkills } from '@cv/shared';
import { groupTitle, type Draft } from './draft.js';
import {
  parseDates,
  type ReviewIssue,
  type ReviewOutput,
  type ReviewTarget,
  type ReviewView,
} from './review.js';

/** A finding the user has to settle: the item is out of the CV (or its field empty) until they answer. */
export interface Asked {
  target: ReviewTarget;
  question: string | null;
  /** The text the question is about: the reviewer's proposal, or the item as the author wrote it. */
  context: string;
  /** What the CV said before the finding took it out: shown in "Not in your CV" past the question cap. */
  original: string;
}

type FieldTarget = Extract<ReviewTarget, { kind: 'field' | 'education' | 'entry' }>;

/**
 * Applies the reviewer's findings to the draft in place (the view's targets point into it): a fix
 * replaces the text or field, an ask takes the item out or empties the field and becomes a question.
 * Items the review does not name stay as they are. The first finding on an item wins.
 */
export function applyReview(
  draft: Draft,
  review: ReviewOutput,
  view: ReviewView,
  targetRole: string,
): Asked[] {
  const asked: Asked[] = [];
  const seen = new Set<string>();
  for (const issue of review.issues) {
    const target = view.targets.get(issue.item);
    if (!target || seen.has(issue.item)) continue;
    seen.add(issue.item);
    if (issue.action === 'fix') fix(draft, target, issue, targetRole);
    else ask(draft, target, issue, targetRole, asked);
  }
  return asked;
}

function fix(draft: Draft, target: ReviewTarget, issue: ReviewIssue, targetRole: string): void {
  const text = (issue.text ?? '').trim();
  // As in the draft: a headline without evidence is the target role.
  if (
    target.kind === 'item' &&
    target.place.section === 'headline' &&
    issue.segments.length === 0
  ) {
    Object.assign(target.item, { text: targetRole, segments: [], kept: false });
  } else if (target.kind === 'item') {
    Object.assign(target.item, { text, segments: [...issue.segments], kept: false });
  } else if (target.kind === 'title') {
    target.group.title = groupTitle(text);
  } else if (target.kind === 'skills') {
    const group = draft.skills[target.group];
    if (!group) return;
    group.items = splitSkills(text);
    if (issue.segments.length > 0) group.segments = [...issue.segments];
    group.kept = false;
  } else if (target.field === 'dates') {
    // The schema refused a fix that does not read as dates, so this always parses.
    const dates = parseDates(text);
    if (dates) setDates(draft, target, dates);
  } else {
    setField(draft, target, text);
  }
}

function ask(
  draft: Draft,
  target: ReviewTarget,
  issue: ReviewIssue,
  targetRole: string,
  asked: Asked[],
): void {
  // An empty proposal is no proposal: the question then shows the item as the author wrote it.
  const trimmed = issue.text?.trim() ?? '';
  const proposal = trimmed === '' ? null : trimmed;
  const push = (original: string) =>
    asked.push({ target, question: issue.question, context: proposal ?? original, original });
  if (target.kind === 'item') {
    // A headline needs no evidence when it is the target role, so that is what replaces a doubtful one.
    if (target.place.section === 'headline') {
      Object.assign(target.item, { text: targetRole, segments: [], kept: false });
      return;
    }
    target.item.removed = true;
    push(target.item.text);
  } else if (target.kind === 'title') {
    // A doubtful group title goes and its items stay as a plain list: nothing to ask about.
    target.group.title = null;
  } else if (target.kind === 'skills') {
    const group = draft.skills[target.group];
    if (!group) return;
    group.removed = true;
    push(group.items.join(', '));
  } else {
    if (target.kind === 'entry') {
      const entry = entryOf(draft, target);
      if (entry) entry.asked = true;
    }
    if (target.field === 'dates') {
      const before = datesText(draft, target);
      setDates(draft, target, { start: null, end: null, current: false });
      push(before);
    } else {
      push(setField(draft, target, ''));
    }
  }
}

const entryOf = (draft: Draft, target: Extract<ReviewTarget, { kind: 'entry' }>) =>
  draft.additional[target.section]?.entries[target.entry];

/** Sets a named field of a job, a school or an extra entry and returns what it held. */
function setField(draft: Draft, target: FieldTarget, value: string): string {
  if (target.kind === 'entry') {
    const entry = entryOf(draft, target);
    if (!entry || target.field === 'dates') return '';
    const before = entry.title;
    entry.title = value;
    return before;
  }
  if (target.kind === 'field') {
    const job = draft.experience[target.job];
    if (!job || target.field === 'dates') return '';
    const before = job[target.field];
    job[target.field] = value;
    return before;
  }
  const entry = draft.education[target.entry];
  if (!entry || target.field === 'dates') return '';
  const before = entry[target.field];
  entry[target.field] = value;
  return before;
}

function setDates(
  draft: Draft,
  target: FieldTarget,
  { start, end, current }: { start: string | null; end: string | null; current: boolean },
): void {
  if (target.kind === 'field') {
    const job = draft.experience[target.job];
    if (job) Object.assign(job, { start, end: current ? null : end, current });
    return;
  }
  const entry = target.kind === 'entry' ? entryOf(draft, target) : draft.education[target.entry];
  if (entry) Object.assign(entry, { start, end });
}

function datesText(draft: Draft, target: FieldTarget): string {
  const entry =
    target.kind === 'field'
      ? draft.experience[target.job]
      : target.kind === 'entry'
        ? entryOf(draft, target)
        : draft.education[target.entry];
  return entry ? [entry.start, entry.end].filter(Boolean).join(' – ') : '';
}
