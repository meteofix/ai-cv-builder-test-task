import { dateSchema, LIMITS } from '@cv/shared';
import { z } from 'zod';
import { splitSkills } from '../../grounding/index.js';
import { verbatim, type SegmentIndex } from './verbatim.js';

const field = z.string().max(LIMITS.maxFieldChars);
// The SDK turns a pattern into a hint in the description, so the format is also checked below.
const date = dateSchema;
const segmentIds = z.array(z.string().max(16)).max(LIMITS.maxFactIds);

/**
 * One text item of the document: `text: null` keeps the cited segments word for word (the server copies
 * them); a text is a changed or new item, and its segments are the evidence.
 */
const itemSchema = z.object({
  text: z
    .string()
    .nullable()
    .describe('null keeps the cited segments word for word; otherwise the rewritten text'),
  segments: segmentIds.describe('ids of the segments it comes from'),
});
export type AuthorItem = z.infer<typeof itemSchema>;

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
    z.object({ field: z.enum(CONTACT_FIELDS), value: field, segment: z.string().max(16) }),
  ),
  headline: itemSchema,
  summary: z.array(itemSchema),
  experience: z.array(
    z.object({
      title: field,
      company: field,
      location: field.describe('"" when the source names none'),
      start: date.describe('YYYY or YYYY-MM; null when the source does not say'),
      end: date.describe('YYYY or YYYY-MM; null when current or not given'),
      current: z.boolean(),
      segments: segmentIds.describe('where the title, company and dates stand'),
      bullets: z.array(itemSchema),
    }),
  ),
  education: z.array(
    z.object({
      institution: field,
      degree: field.describe('with its specialization; "" when none'),
      start: date,
      end: date,
      segments: segmentIds,
    }),
  ),
  skills: z.array(
    z.object({
      title: field.describe('"" for a group without a title'),
      segments: segmentIds,
      items: z
        .array(field)
        .describe(
          'empty: the server cuts the cited lines into skills; names only when regrouped or respelled',
        ),
    }),
  ),
  additional: z.array(z.object({ title: field, items: z.array(itemSchema) })),
  notIncluded: z.array(
    z.object({
      segments: segmentIds,
      section: z.enum(NOT_INCLUDED_SECTIONS),
      job: z
        .number()
        .int()
        .describe(
          'for experience: number of the job it belongs to, 1 = first in experience; else 0',
        ),
      reason: z.string().max(LIMITS.maxFieldChars),
    }),
  ),
  headings: z
    .array(z.string().max(16))
    .describe('ids of segments that are only headings, labels or decoration'),
  gaps: z.array(
    z.object({
      kind: z.enum(GAP_KINDS),
      job: z
        .number()
        .int()
        .describe('number of the job it is about, 1 = first in experience; else 0'),
      education: z
        .number()
        .int()
        .describe('number of the education entry it is about, 1 = first; else 0'),
      question: z
        .string()
        .max(LIMITS.maxFieldChars)
        .describe('the question to the person, in the language of the CV'),
    }),
  ),
  orderReason: z
    .string()
    .max(LIMITS.maxFieldChars)
    .describe('why an older job comes first; "" when the experience is newest first'),
});
export type AuthorOutput = z.infer<typeof authorOutputSchema>;

/** The text an item stands for in the CV. */
export function itemText(item: AuthorItem, index: SegmentIndex): string {
  return item.text === null ? verbatim(item.segments, index) : item.text.trim();
}

/** The skills of a group: the author's list, or the cited lines cut at separators. */
export function groupSkills(group: AuthorOutput['skills'][number], index: SegmentIndex): string[] {
  // Line by line, so a label in front of each line ("Tools: …") is cut, not only the first.
  return group.items.length > 0
    ? group.items
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
      if (value.text !== null && value.text.trim() === '') issue(path, 'Empty text');
    };

    const dates = (
      path: (string | number)[],
      entry: { start: string | null; end: string | null },
    ) => {
      for (const key of ['start', 'end'] as const) {
        if (!dateSchema.safeParse(entry[key]).success)
          issue([...path, key], `Use YYYY or YYYY-MM, or null, not ${JSON.stringify(entry[key])}`);
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
      if (job.bullets.length > LIMITS.maxBulletsPerPosition) {
        issue(['experience', i, 'bullets'], `More than ${LIMITS.maxBulletsPerPosition} bullets`);
      }
      job.bullets.forEach((bullet, j) => {
        item(['experience', i, 'bullets', j], bullet, LIMITS.maxBulletChars);
      });
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
    output.skills.forEach((group, i) => {
      cites(['skills', i], group.segments);
      if (group.segments.length === 0) issue(['skills', i], 'Cite at least one segment');
    });
    const skills = output.skills.flatMap((group) => groupSkills(group, index));
    if (skills.length > LIMITS.maxSkills) issue(['skills'], `More than ${LIMITS.maxSkills} skills`);
    if (output.additional.length > LIMITS.maxAdditionalSections) {
      issue(['additional'], `More than ${LIMITS.maxAdditionalSections} sections`);
    }
    output.additional.forEach((section, i) => {
      if (section.items.length > LIMITS.maxAdditionalItems) {
        issue(['additional', i], `More than ${LIMITS.maxAdditionalItems} items`);
      }
      section.items.forEach((value, j) => {
        item(['additional', i, 'items', j], value, LIMITS.maxTextChars);
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
