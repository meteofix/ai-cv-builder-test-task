import { dateSchema, LIMITS, splitSkills } from '@cv/shared';
import { z } from 'zod';
import { verbatim, type SegmentIndex } from './verbatim.js';

/*
 * The service compiles this schema into a grammar with a size cap, and the author's answer sits close to
 * it (decision 036): every `null` alternative, `$ref`, length limit (the SDK writes it into the
 * description) and description counts. So "" means none, parts are fresh instances from functions (an
 * instance used twice becomes a `$ref`), there are no limits, and only the hints the prompt does not give
 * are described. The rules the grammar cannot hold are in `authorSchema`, checked with a re-ask.
 */
const field = () => z.string();
// The format is in the description, not a pattern (the SDK would add the pattern to the description as
// well); `authorSchema` checks it.
const date = (hint = 'YYYY or YYYY-MM; "" when the source does not say') =>
  z.string().describe(hint);
// 0 means none, so an omitted number is read as 0 rather than re-asked: in the tool mode the service
// does not hold the model to the required fields (decision 036).
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
      question: z.string().describe('the question to the person, in the language of the CV'),
    }),
  ),
  orderReason: z
    .string()
    .describe(
      'for the person: why an older job comes first, in one short plain sentence; "" when the experience is newest first',
    ),
  structureNotes: z
    .string()
    .describe(
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
  // Line by line, so a label in front of each line ("Tools: …") is cut, not only the first.
  return group.items.length > 0
    ? group.items.map((name) => name.trim()).filter(Boolean)
    : group.segments.flatMap((id) => splitSkills(verbatim([id], index)));
}

/**
 * The author's schema for one source: every cited id exists, an item cites at least one segment, and
 * the document fits `LIMITS` once kept text is filled in. A failure is sent back to the model with the
 * re-ask, so nothing over a limit is ever cut.
 */
export function authorSchema(index: SegmentIndex) {
  return authorOutputSchema.superRefine((output, context) => {
    const issue = (path: (string | number)[], message: string) => {
      context.addIssue({ code: 'custom', path, message });
    };
    const cites = (path: (string | number)[], ids: readonly string[]) => {
      for (const id of ids) if (!index.has(id)) issue(path, `Unknown segment id ${id}`);
    };
    const item = (path: (string | number)[], value: AuthorItem, max: number) => {
      cites(path, value.segments);
      if (value.segments.length === 0) issue(path, 'Cite at least one segment');
      if (itemText(value, index).length > max) {
        issue(path, `Longer than ${max} characters: rewrite it shorter`);
      }
    };

    // Every plain string of the answer (titles, names, reasons, questions) is a field of the document;
    // item texts have their own limits below.
    const fields = (path: (string | number)[], value: unknown) => {
      if (typeof value === 'string' && value.length > LIMITS.maxFieldChars) {
        issue(path, `Longer than ${LIMITS.maxFieldChars} characters`);
      } else if (Array.isArray(value)) {
        value.forEach((child, i) => {
          fields([...path, i], child);
        });
      } else if (typeof value === 'object' && value !== null) {
        for (const [key, child] of Object.entries(value)) {
          if (key !== 'text' && key !== 'structureNotes') fields([...path, key], child);
        }
      }
    };
    fields([], output);
    // Notes for evals only, never shown: long enough for a few changes, still bounded.
    if (output.structureNotes.length > LIMITS.maxTextChars) {
      issue(['structureNotes'], `Longer than ${LIMITS.maxTextChars} characters`);
    }

    const groups = (path: (string | number)[], list: readonly AuthorGroup[], max: number) => {
      if (list.length > LIMITS.maxGroupsPerList) {
        issue([...path, 'groups'], `More than ${LIMITS.maxGroupsPerList} groups`);
      }
      list.forEach((group, g) => {
        group.items.forEach((value, j) => {
          item([...path, 'groups', g, 'items', j], value, max);
        });
      });
    };

    const dates = (path: (string | number)[], entry: { start: string; end: string }) => {
      for (const key of ['start', 'end'] as const) {
        if (!dateSchema.safeParse(dateOf(entry[key])).success)
          issue([...path, key], `Use YYYY or YYYY-MM, or "", not ${JSON.stringify(entry[key])}`);
      }
    };

    output.contacts.forEach((contact, i) => {
      cites(['contacts', i], [contact.segment]);
    });
    cites(['headline'], output.headline.segments);
    output.summary.forEach((value, i) => {
      item(['summary', i], value, LIMITS.maxSummaryChars);
    });
    const summary = output.summary.map((value) => itemText(value, index)).join(' ');
    if (summary.length > LIMITS.maxSummaryChars) {
      issue(['summary'], `The summary is longer than ${LIMITS.maxSummaryChars} characters`);
    }
    if (output.experience.length > LIMITS.maxExperience) {
      issue(['experience'], `More than ${LIMITS.maxExperience} jobs`);
    }
    // A job or a school that says anything cites where it stands, so the reviewer can check it.
    const sourced = (
      path: (string | number)[],
      ids: readonly string[],
      fields: (string | null)[],
    ) => {
      if (ids.length === 0 && fields.some((value) => value !== null && value.trim() !== '')) {
        issue(path, 'Cite the segments its title, company or dates come from');
      }
    };
    output.experience.forEach((job, i) => {
      cites(['experience', i], job.segments);
      sourced(['experience', i], job.segments, [
        job.title,
        job.company,
        job.location,
        job.start,
        job.end,
      ]);
      dates(['experience', i], job);
      groups(['experience', i], job.groups, LIMITS.maxBulletChars);
      const bullets = job.groups.reduce((sum, group) => sum + group.items.length, 0);
      if (bullets > LIMITS.maxBulletsPerPosition) {
        issue(['experience', i, 'groups'], `More than ${LIMITS.maxBulletsPerPosition} bullets`);
      }
    });
    if (output.education.length > LIMITS.maxEducation) {
      issue(['education'], `More than ${LIMITS.maxEducation} entries`);
    }
    output.education.forEach((entry, i) => {
      cites(['education', i], entry.segments);
      sourced(['education', i], entry.segments, [
        entry.institution,
        entry.degree,
        entry.start,
        entry.end,
      ]);
      dates(['education', i], entry);
    });
    // What the document would drop must not be cited: its segments would count as placed (decision 035).
    output.skills.forEach((group, i) => {
      cites(['skills', i], group.segments);
      if (group.segments.length === 0) issue(['skills', i], 'Cite at least one segment');
      else if (groupSkills(group, index).length === 0)
        issue(['skills', i], 'Name at least one skill');
    });
    const skills = output.skills.flatMap((group) => groupSkills(group, index));
    if (skills.some((name) => name.length > LIMITS.maxFieldChars)) {
      issue(['skills'], `A skill name is longer than ${LIMITS.maxFieldChars} characters`);
    }
    if (skills.length > LIMITS.maxSkills) issue(['skills'], `More than ${LIMITS.maxSkills} skills`);
    if (output.additional.length > LIMITS.maxAdditionalSections) {
      issue(['additional'], `More than ${LIMITS.maxAdditionalSections} sections`);
    }
    output.additional.forEach((section, i) => {
      if (section.entries.length > LIMITS.maxAdditionalItems) {
        issue(['additional', i], `More than ${LIMITS.maxAdditionalItems} entries`);
      }
      section.entries.forEach((entry, j) => {
        const path = ['additional', i, 'entries', j];
        cites(path, entry.segments);
        sourced(path, entry.segments, [entry.title, entry.start, entry.end]);
        dates(path, entry);
        groups(path, entry.groups, LIMITS.maxTextChars);
        const lines = entry.groups.reduce((sum, group) => sum + group.items.length, 0);
        if (lines > LIMITS.maxLinesPerEntry) {
          issue([...path, 'groups'], `More than ${LIMITS.maxLinesPerEntry} lines`);
        }
        if (lines === 0 && entry.title.trim() === '') {
          issue(path, 'Give the entry a title or at least one line');
        }
      });
    });
    output.notIncluded.forEach((entry, i) => {
      cites(['notIncluded', i], entry.segments);
      if (entry.job > 0 && !output.experience[entry.job - 1]) {
        issue(['notIncluded', i, 'job'], `There is no job ${entry.job}`);
      }
    });
    cites(['headings'], output.headings);
    output.gaps.forEach((gap, i) => {
      if (gap.job > 0 && !output.experience[gap.job - 1]) {
        issue(['gaps', i, 'job'], `There is no job ${gap.job}`);
      }
      if (gap.education > 0 && !output.education[gap.education - 1]) {
        issue(['gaps', i, 'education'], `There is no education entry ${gap.education}`);
      }
    });
  });
}
