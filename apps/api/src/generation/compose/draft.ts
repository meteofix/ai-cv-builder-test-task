import { LIMITS, type CvDocument, type Locale } from '@cv/shared';
import { checkEmail, checkLink, checkPhone } from '../../grounding/index.js';
import { groupSkills, itemText, type AuthorItem, type AuthorOutput } from './author-schema.js';
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

export interface DraftJob {
  title: string;
  company: string;
  location: string;
  start: string | null;
  end: string | null;
  current: boolean;
  segments: string[];
  bullets: DraftItem[];
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
export interface Draft {
  locale: Locale;
  fullName: DraftItem | null;
  location: DraftItem | null;
  email: string;
  phone: string;
  links: string[];
  /** Segments of the contacts, kept or not: they were read, so they count as placed. */
  contactSegments: string[];
  headline: DraftItem;
  summary: DraftItem[];
  experience: DraftJob[];
  education: DraftEducation[];
  skills: DraftSkillGroup[];
  additional: { title: string; items: DraftItem[] }[];
}

function draftItem(item: AuthorItem, index: SegmentIndex): DraftItem {
  return { text: itemText(item, index), segments: [...item.segments], kept: item.text === null };
}

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
  const contacts = (field: AuthorOutput['contacts'][number]['field']) =>
    output.contacts.filter((contact) => contact.field === field);
  // The name and the location are not matched against their segment: a name may be transliterated or
  // re-cased, so the reviewer checks them as items instead.
  const first = (field: 'fullName' | 'location'): DraftItem | null => {
    const contact = contacts(field)[0];
    return contact
      ? { text: contact.value.trim(), segments: [contact.segment], kept: false }
      : null;
  };
  const checked = (field: 'email' | 'phone', check: (value: string) => string | null) =>
    contacts(field)
      .map((contact) => check(contact.value))
      .find((value) => value !== null) ?? '';
  const links = [
    ...new Set(
      contacts('link')
        .map((contact) => checkLink(contact.value, source))
        .filter((link) => link !== null),
    ),
  ];
  const headline = draftItem(output.headline, index);
  return {
    locale: output.locale === 'uk' ? 'uk' : 'en',
    fullName: first('fullName'),
    location: first('location'),
    email: checked('email', (value) => checkEmail(value, source)),
    phone: checked('phone', (value) => checkPhone(value, source)),
    links: links.slice(0, LIMITS.maxLinks),
    contactSegments: output.contacts.map((contact) => contact.segment),
    // A headline is the person's own line or the target role: one without evidence is the role.
    headline:
      headline.segments.length === 0 ? { text: targetRole, segments: [], kept: false } : headline,
    summary: output.summary.map((item) => draftItem(item, index)),
    experience: output.experience.map((job) => ({
      title: job.title.trim(),
      company: job.company.trim(),
      location: job.location.trim(),
      start: job.start,
      end: job.current ? null : job.end,
      current: job.current,
      segments: [...job.segments],
      bullets: job.bullets.map((item) => draftItem(item, index)),
    })),
    education: output.education.map((entry) => ({
      institution: entry.institution.trim(),
      degree: entry.degree.trim(),
      start: entry.start,
      end: entry.end,
      segments: [...entry.segments],
    })),
    skills: output.skills.map((group) => ({
      title: group.title.trim() || null,
      items: groupSkills(group, index),
      segments: [...group.segments],
      kept: group.items.length === 0,
    })),
    additional: output.additional.map((section) => ({
      title: section.title.trim(),
      items: section.items.map((item) => draftItem(item, index)),
    })),
  };
}

export const positionId = (job: number) => `p${job + 1}`;
export const educationId = (entry: number) => `e${entry + 1}`;
export const additionalId = (section: number) => `a${section + 1}`;

const live = <T extends { removed?: boolean }>(items: readonly T[]) =>
  items.filter((item) => !item.removed);

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
      bullets: live(job.bullets).map((bullet, j) => ({
        id: `${positionId(i)}-b${j + 1}`,
        text: bullet.text,
        factIds: bullet.segments.slice(0, LIMITS.maxFactIds),
      })),
    })),
    education: draft.education.map((entry, i) => ({
      id: educationId(i),
      ...(entry.segments[0] ? { factId: entry.segments[0] } : {}),
      institution: entry.institution,
      ...(entry.degree ? { degree: entry.degree } : {}),
      start: entry.start,
      end: entry.end,
    })),
    skills: live(draft.skills).flatMap((group, i) =>
      group.items.map((name, j) => ({
        id: `k${i + 1}-${j + 1}`,
        name,
        ...(group.segments[0] ? { factId: group.segments[0] } : {}),
      })),
    ),
    additional: draft.additional
      .map((section, i) => ({
        id: additionalId(i),
        title: section.title,
        items: live(section.items).map((item, j) => ({
          id: `${additionalId(i)}-i${j + 1}`,
          text: item.text,
          factIds: item.segments.slice(0, LIMITS.maxFactIds),
        })),
      }))
      .filter((section) => section.items.length > 0),
  };
}
