import { LIMITS, type CvDocument, type Locale } from '@cv/shared';
import {
  dateOf,
  groupSkills,
  itemText,
  kept,
  type AuthorGroup,
  type AuthorItem,
  type AuthorOutput,
} from './author-schema.js';
import { draftContacts, type DraftContacts } from './draft-contacts.js';
import type { SegmentIndex } from './verbatim.js';

/** A text item between the author and the document: what it says, what it cites, whether it is the source's. */
export interface DraftItem {
  text: string;
  segments: string[];
  /** Copied from the source word for word; the reviewer checks only where it stands. */
  kept: boolean;
  /** Taken out by the reviewer until the user answers its question. */
  removed?: boolean;
}

/** A titled or plain group of items (decision 036); the reviewer checks a title like any claim. */
export interface DraftGroup {
  title: string | null;
  items: DraftItem[];
}

export interface DraftJob {
  title: string;
  company: string;
  location: string;
  start: string | null;
  end: string | null;
  current: boolean;
  segments: string[];
  groups: DraftGroup[];
}

/** One record of an extra section: a project, a course, a certificate. */
export interface DraftEntry {
  title: string;
  start: string | null;
  end: string | null;
  segments: string[];
  groups: DraftGroup[];
  /** The review asked for its title or dates: it stays even when empty, so the answer has a place. */
  asked?: boolean;
}

export interface DraftEducation {
  institution: string;
  degree: string;
  start: string | null;
  end: string | null;
  segments: string[];
}

export interface DraftSkillGroup {
  title: string | null;
  items: string[];
  segments: string[];
  kept: boolean;
  removed?: boolean;
}

/** The CV before the review: the author's answer with kept text filled in and contacts checked. */
export interface Draft extends DraftContacts {
  locale: Locale;
  /** Segments the author called headings, labels or decoration, with their text: the reviewer sees them. */
  headings: { segment: string; text: string }[];
  headline: DraftItem;
  summary: DraftItem[];
  experience: DraftJob[];
  education: DraftEducation[];
  skills: DraftSkillGroup[];
  additional: { title: string; entries: DraftEntry[] }[];
}

function draftItem(item: AuthorItem, index: SegmentIndex): DraftItem {
  return { text: itemText(item, index), segments: [...item.segments], kept: kept(item) };
}

// A skill group's title gets its colon from the template ("Cloud:" would print as "Cloud::"), and a
// title of bullets is a heading that needs none.
export const groupTitle = (title: string) => title.trim().replace(/:+$/, '').trim() || null;

function draftGroups(groups: readonly AuthorGroup[], index: SegmentIndex): DraftGroup[] {
  return groups.map((group) => ({
    title: groupTitle(group.title),
    items: group.items.map((item) => draftItem(item, index)),
  }));
}

/** Every item of a list of groups, group after group. */
export const groupItems = (groups: readonly DraftGroup[]) => groups.flatMap((group) => group.items);

/**
 * The author's answer as a draft. The only judgements here are mechanical: kept text is the source's,
 * an email, phone or link the source does not contain is dropped, and a headline without evidence is
 * the target role (docs/specs/generation.md §3.3).
 */
export function buildDraft(
  output: AuthorOutput,
  index: SegmentIndex,
  source: string,
  targetRole: string,
): Draft {
  const headline = draftItem(output.headline, index);
  return {
    locale: output.locale === 'uk' ? 'uk' : 'en',
    // Once each, and not a segment the author already lists as left out: the panel shows that one.
    headings: [...new Set(output.headings)]
      .filter((segment) => !output.notIncluded.some((entry) => entry.segments.includes(segment)))
      .flatMap((segment) => {
        const text = index.get(segment)?.text;
        return text === undefined ? [] : [{ segment, text }];
      }),
    ...draftContacts(output, source),
    // A headline is the person's own line or the target role: one without evidence is the role.
    headline:
      headline.segments.length === 0 ? { text: targetRole, segments: [], kept: false } : headline,
    summary: output.summary.map((item) => draftItem(item, index)),
    experience: output.experience.map((job) => ({
      title: job.title.trim(),
      company: job.company.trim(),
      location: job.location.trim(),
      start: dateOf(job.start),
      end: job.current ? null : dateOf(job.end),
      current: job.current,
      segments: [...job.segments],
      groups: draftGroups(job.groups, index),
    })),
    education: output.education.map((entry) => ({
      institution: entry.institution.trim(),
      degree: entry.degree.trim(),
      start: dateOf(entry.start),
      end: dateOf(entry.end),
      segments: [...entry.segments],
    })),
    skills: output.skills.map((group) => ({
      title: groupTitle(group.title),
      items: groupSkills(group, index),
      segments: [...group.segments],
      kept: group.items.length === 0,
    })),
    additional: output.additional.map((section) => ({
      title: section.title.trim(),
      entries: section.entries.map((entry) => ({
        title: entry.title.trim(),
        start: dateOf(entry.start),
        end: dateOf(entry.end),
        segments: [...entry.segments],
        groups: draftGroups(entry.groups, index),
      })),
    })),
  };
}

export const positionId = (job: number) => `p${job + 1}`;
export const educationId = (entry: number) => `e${entry + 1}`;
export const additionalId = (section: number) => `a${section + 1}`;

const live = <T extends { removed?: boolean }>(items: readonly T[]) =>
  items.filter((item) => !item.removed);

/**
 * Groups as the document stores them. Item ids run across the groups of one list, so an item keeps its
 * id when it moves to another group; a group left empty by the review is dropped.
 */
function documentGroups(groups: readonly DraftGroup[], prefix: string, letter: string) {
  let n = 0;
  return groups
    .map((group, g) => ({
      id: `${prefix}-g${g + 1}`,
      title: group.title,
      items: live(group.items).map((item) => ({
        id: `${prefix}-${letter}${++n}`,
        text: item.text,
        factIds: item.segments.slice(0, LIMITS.maxFactIds),
      })),
    }))
    .filter((group) => group.items.length > 0);
}

function citations(items: readonly { segments: readonly string[] }[]): string[] {
  // The summary is one text in the document; its provenance is the union, capped like any item's.
  return [...new Set(items.flatMap((item) => item.segments))].slice(0, LIMITS.maxFactIds);
}

/** The document the editor gets. Ids follow the draft's order, so questions can name their targets. */
export function toDocument(draft: Draft): CvDocument {
  const summary = live(draft.summary);
  return {
    locale: draft.locale,
    contacts: {
      fullName: draft.fullName?.removed ? '' : (draft.fullName?.text ?? ''),
      email: draft.email,
      phone: draft.phone,
      location: draft.location?.removed ? '' : (draft.location?.text ?? ''),
      links: draft.links,
    },
    headline: draft.headline.text,
    summary: { text: summary.map((item) => item.text).join(' '), factIds: citations(summary) },
    experience: draft.experience.map((job, i) => ({
      id: positionId(i),
      ...(job.segments[0] ? { factId: job.segments[0] } : {}),
      company: job.company,
      title: job.title,
      ...(job.location ? { location: job.location } : {}),
      start: job.start,
      end: job.current ? null : job.end,
      current: job.current,
      groups: documentGroups(job.groups, positionId(i), 'b'),
    })),
    education: draft.education.map((entry, i) => ({
      id: educationId(i),
      ...(entry.segments[0] ? { factId: entry.segments[0] } : {}),
      institution: entry.institution,
      ...(entry.degree ? { degree: entry.degree } : {}),
      start: entry.start,
      end: entry.end,
    })),
    skills: live(draft.skills)
      .map((group, i) => ({
        id: `k${i + 1}`,
        title: group.title,
        items: group.items.map((name, j) => ({
          id: `k${i + 1}-${j + 1}`,
          name,
          ...(group.segments[0] ? { factId: group.segments[0] } : {}),
        })),
      }))
      .filter((group) => group.items.length > 0),
    additional: draft.additional
      .map((section, i) => ({
        id: additionalId(i),
        title: section.title,
        entries: section.entries.flatMap((entry, j) => {
          const id = `${additionalId(i)}-e${j + 1}`;
          const groups = documentGroups(entry.groups, id, 'i');
          // An entry with a title is a record on its own (a course, a certificate); one with nothing
          // left is dropped, unless a question about it is waiting for the answer.
          if (entry.title === '' && groups.length === 0 && !entry.asked) return [];
          return [{ id, title: entry.title, start: entry.start, end: entry.end, groups }];
        }),
      }))
      .filter((section) => section.entries.length > 0),
  };
}
