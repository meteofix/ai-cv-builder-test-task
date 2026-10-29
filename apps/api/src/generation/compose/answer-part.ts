import { LIMITS, type CvDocument, type QuestionTarget } from '@cv/shared';
import { isInstruction, sourceLines, type Segment } from '../../grounding/index.js';
import type { PreparedSource } from './compose.js';
import { indexSegments, type SegmentIndex } from './verbatim.js';

/** At most this many items make up a rewritten summary: a summary is a few sentences, not a list. */
const SUMMARY_SENTENCES = 6;

/*
 * A content answer rewrites one part of the CV (docs/specs/generation.md §5): one group of a job's
 * bullets or of an entry's lines, or the summary. The answer becomes a segment `A1…` the author and the
 * reviewer cite like the source; items the person wrote (no segments) stay as they are.
 */

/**
 * How much an answer may change (the owner's decision in decision 037): a question about one item the
 * review took out (`unverified`) gets that one item back and nothing else; a question about a group, a
 * job or the summary as a whole may rewrite and add to it.
 */
export type Scope = 'item' | 'group';
/** Where a group stands; `group: null` is a new untitled group at the end. */
export type GroupPart =
  | { kind: 'group'; scope: Scope; section: 'experience'; job: number; group: number | null }
  | {
      kind: 'group';
      scope: Scope;
      section: 'additional';
      index: number;
      entry: number;
      group: number | null;
    };
export type Part = { kind: 'summary'; scope: Scope } | GroupPart;

export const scopeOf = (kind: string): Scope => (kind === 'unverified' ? 'item' : 'group');

type Groups = CvDocument['experience'][number]['groups'];

/**
 * The group a job- or entry-level answer lands in: the first without a title, else a new one. A titled group is the source's subsection; new content does not belong under its claim.
 */
function plainGroup(groups: Groups): number | null {
  const index = groups.findIndex((group) => group.title === null);
  return index < 0 ? null : index;
}

/**
 * The part an answer rewrites, or null when it no longer exists. A target is a job or an entry, or one
 * of their groups (`p1-g2`); a group the person has since removed falls back to its owner, whose ids
 * prefix the ids of its groups.
 */
export function partOf(
  document: CvDocument,
  target: QuestionTarget,
  scope: Scope = 'group',
): Part | null {
  if (target.section === 'summary') return { kind: 'summary', scope };
  const id = target.itemId;
  if (id === undefined) return null;
  const locate = (owner: { id: string; groups: Groups }) => {
    if (owner.id === id) return { found: true, group: plainGroup(owner.groups) };
    const group = owner.groups.findIndex((candidate) => candidate.id === id);
    if (group >= 0) return { found: true, group };
    if (id.startsWith(`${owner.id}-`)) return { found: true, group: plainGroup(owner.groups) };
    return { found: false, group: null };
  };
  if (target.section === 'experience') {
    for (const [job, position] of document.experience.entries()) {
      const { found, group } = locate(position);
      if (found) return { kind: 'group', scope, section: 'experience', job, group };
    }
    return null;
  }
  if (target.section === 'additional') {
    for (const [index, section] of document.additional.entries()) {
      for (const [entry, record] of section.entries.entries()) {
        const { found, group } = locate(record);
        if (found) return { kind: 'group', scope, section: 'additional', index, entry, group };
      }
    }
  }
  return null;
}

export interface PartItem {
  text: string;
  /** Segment ids; empty for text the person wrote in the editor. */
  factIds: string[];
}

/** The groups the part belongs to: the bullets of its job or the lines of its entry. */
export function partGroups(document: CvDocument, part: GroupPart): Groups {
  return part.section === 'experience'
    ? (document.experience[part.job]?.groups ?? [])
    : (document.additional[part.index]?.entries[part.entry]?.groups ?? []);
}

export function partItems(document: CvDocument, part: Part): PartItem[] {
  if (part.kind === 'summary') {
    const { text, factIds } = document.summary;
    return text.trim() ? [{ text, factIds }] : [];
  }
  return part.group === null ? [] : (partGroups(document, part)[part.group]?.items ?? []);
}

/** The part's items the answer may rewrite: those the AI wrote, and only for a group-wide answer. */
export function partRewritten(document: CvDocument, part: Part): PartItem[] {
  if (part.scope === 'item') return [];
  return partItems(document, part).filter((item) => item.factIds.length > 0);
}

/** The part's items that stay as they are: the person's own, and every item for a one-item answer. */
export function partKept(document: CvDocument, part: Part): PartItem[] {
  if (part.scope === 'item') return partItems(document, part);
  return partItems(document, part).filter((item) => item.factIds.length === 0);
}

/** The limits of the part's items: their length and how many the owner may hold in all. */
export function partLimits(part: Part): { chars: number; items: number } {
  if (part.kind === 'summary') return { chars: LIMITS.maxSummaryChars, items: SUMMARY_SENTENCES };
  return part.section === 'experience'
    ? { chars: LIMITS.maxBulletChars, items: LIMITS.maxBulletsPerPosition }
    : { chars: LIMITS.maxTextChars, items: LIMITS.maxLinesPerEntry };
}

/** How many new items the part may take: the owner's limit minus everything that stays; one for an item. */
export function partRoom(document: CvDocument, part: Part): number {
  const { items } = partLimits(part);
  const others =
    part.kind === 'summary'
      ? 0
      : partGroups(document, part)
          .filter((_, g) => g !== part.group)
          .reduce((sum, group) => sum + group.items.length, 0);
  const room = Math.max(0, items - others - partKept(document, part).length);
  return part.scope === 'item' ? Math.min(1, room) : room;
}

/**
 * Whether the outcome is known before any model call: a summary the person wrote stays, and a part with
 * no room (or a new group past the group limit) takes nothing new.
 */
export function partSettled(document: CvDocument, part: Part): boolean {
  if (part.kind === 'summary') {
    return document.summary.factIds.length === 0 && document.summary.text.trim() !== '';
  }
  const full = part.group === null && partGroups(document, part).length >= LIMITS.maxGroupsPerList;
  return full || partRoom(document, part) === 0;
}

/** The stored answers as segments, the new one last; an instruction-like answer is never shown. */
export function answerSegments(answers: readonly string[]): Segment[] {
  return answers.map((text, i) => ({
    id: `A${i + 1}`,
    text: text.trim(),
    span: [0, 0],
    // Newlines are flattened when matching, so a role prefix on a later line needs a line of its own.
    instruction: isInstruction(text) || sourceLines(text).some((line) => isInstruction(line.text)),
  }));
}

/** The source and the answers as one index of what a model may cite. */
export function partIndex(source: PreparedSource, answers: readonly Segment[]): SegmentIndex {
  return indexSegments([
    ...source.index.values(),
    ...answers.filter((segment) => !segment.instruction),
  ]);
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/** Whether an item the author kept word for word is one the part already showed (same segments). */
export function alreadyShown(segments: readonly string[], shown: readonly PartItem[]): boolean {
  return shown.some((item) => sameSet(item.factIds, segments));
}
