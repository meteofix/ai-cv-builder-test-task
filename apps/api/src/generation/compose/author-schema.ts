import { splitSkills } from '@cv/shared';
import { z } from 'zod';
import { verbatim, type SegmentIndex } from './verbatim.js';

/*
 * The author answers through a tool call that the service does not hold to this schema (decision 036):
 * it began on the structured-output grammar, whose size cap it outgrew, so it stays lean — "" means
 * none, parts are fresh instances from functions, and only the hints the prompt does not give are
 * described. Every rule beyond the shape is in `authorSchema` (author-checks.ts), checked with a re-ask.
 */
// "" and 0 mean none, so an omitted string or number is read as none rather than re-asked: in the tool
// mode the service does not hold the model to the required fields (decision 036).
const field = () => z.string().default('');
// The format is in the description, not a pattern (the SDK would add the pattern to the description as
// well); `authorSchema` checks it.
const date = (hint = 'YYYY or YYYY-MM; "" when the source does not say') => field().describe(hint);
const ordinal = (hint: string) => z.number().int().default(0).describe(hint);
const segmentIds = (hint?: string) =>
  hint === undefined ? z.array(z.string()) : z.array(z.string()).describe(hint);

/**
 * One text item of the document: `text: ""` keeps the cited segments word for word (the server copies
 * them); a text is a changed or new item, and its segments are the evidence.
 */
const itemSchema = () =>
  z.object({
    text: z
      .string()
      .describe('"" keeps the cited segments word for word; otherwise the rewritten text'),
    segments: segmentIds(),
  });
export type AuthorItem = z.infer<ReturnType<typeof itemSchema>>;

/** A group of items with an optional title (decision 036); one group without a title is a plain list. */
const groupSchema = () =>
  z.object({
    title: field().describe('"" for a plain list without a title'),
    items: z.array(itemSchema()),
  });
export type AuthorGroup = z.infer<ReturnType<typeof groupSchema>>;

export const CONTACT_FIELDS = ['fullName', 'email', 'phone', 'location', 'link'] as const;
export const GAP_KINDS = [
  'missing_dates',
  'missing_company',
  'missing_title',
  'missing_institution',
  'vague',
] as const;
export const NOT_INCLUDED_SECTIONS = [
  'summary',
  'experience',
  'education',
  'skills',
  'additional',
] as const;

export const authorOutputSchema = z.object({
  /** "en" or "uk": the language of the CV; any other is stored as "en". */
  locale: z.string(),
  contacts: z.array(
    z.object({ field: z.enum(CONTACT_FIELDS), value: field(), segment: z.string() }),
  ),
  headline: itemSchema(),
  summary: z.array(itemSchema()),
  experience: z.array(
    z.object({
      title: field(),
      company: field(),
      location: field().describe('"" when the source names none'),
      start: date(),
      end: date('YYYY or YYYY-MM; "" when current or not given'),
      current: z.boolean(),
      segments: segmentIds('where the title, company and dates stand'),
      groups: z.array(groupSchema()),
    }),
  ),
  education: z.array(
    z.object({
      institution: field(),
      degree: field().describe('with its specialization; "" when none'),
      start: date(),
      end: date(),
      segments: segmentIds(),
    }),
  ),
  skills: z.array(
    z.object({
      title: field().describe('"" for a group without a title'),
      segments: segmentIds(),
      items: z
        .array(z.string())
        .describe(
          'empty: the server cuts the cited lines into skills; names only when regrouped or respelled',
        ),
      wrapped: z
        .boolean()
        .optional()
        .describe(
          'true: the cited lines are one list wrapped mid-name; the server joins them first',
        ),
    }),
  ),
  additional: z.array(
    z.object({
      title: field(),
      entries: z.array(
        z.object({
          title: field().describe('the project, course or certificate with its provider'),
          start: date(),
          end: date(),
          segments: segmentIds('where the title and dates stand'),
          groups: z.array(groupSchema()),
        }),
      ),
    }),
  ),
  notIncluded: z.array(
    z.object({
      segments: segmentIds(),
      section: z.enum(NOT_INCLUDED_SECTIONS),
      job: ordinal(
        'for experience: number of the job it belongs to, 1 = first in experience; else 0',
      ),
      reason: field(),
    }),
  ),
  headings: z
    .array(z.string())
    .describe('ids of segments that are only headings, labels or decoration'),
  gaps: z.array(
    z.object({
      kind: z.enum(GAP_KINDS),
      job: ordinal('number of the job it is about, 1 = first in experience; else 0'),
      education: ordinal('number of the education entry it is about, 1 = first; else 0'),
      question: field().describe('the question to the person, in the language of the CV'),
    }),
  ),
  orderReason: field().describe(
    'for the person: why an older job comes first, in one short plain sentence; "" when the experience is newest first',
  ),
  structureNotes: field().describe(
    'not shown to the person: which subsections of the source you merged or dropped and why; "" when none',
  ),
});
export type AuthorOutput = z.infer<typeof authorOutputSchema>;

/** Whether the item keeps its segments word for word. */
export const kept = (item: AuthorItem) => item.text.trim() === '';

/** A date of the answer as the document stores it: "" is none. */
export const dateOf = (value: string) => (value === '' ? null : value);

/** The text an item stands for in the CV. */
export function itemText(item: AuthorItem, index: SegmentIndex): string {
  return kept(item) ? verbatim(item.segments, index) : item.text.trim();
}

/** The skills of a group: the author's list, or the cited lines cut at separators. */
export function groupSkills(group: AuthorOutput['skills'][number], index: SegmentIndex): string[] {
  if (group.items.length > 0) return group.items.map((name) => name.trim()).filter(Boolean);
  // Line by line, so a label in front of each line ("Tools: …") is cut, not only the first; a list a
  // narrow column wrapped mid-name ("AI" / "agents") is joined first, which only the author can tell.
  const lines = group.wrapped
    ? [verbatim(group.segments, index)]
    : group.segments.map((id) => verbatim([id], index));
  // A cut name ending in a colon is a label on a line of its own (a two-column PDF), not a skill.
  return lines.flatMap(splitSkills).filter((name) => name !== '' && !name.endsWith(':'));
}
