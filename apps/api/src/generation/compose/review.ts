import { dateSchema, experienceGroups, LIMITS, sharesBullets } from '@cv/shared';
import { z } from 'zod';
import type { Draft, DraftGroup, DraftItem } from './draft.js';
import type { SegmentIndex } from './verbatim.js';

/** Classes of a finding; only for logs and evals (the code treats every class the same). */
export const REVIEW_CLASSES = [
  'invented_detail',
  'inflated_scope',
  'wrong_time',
  'wrong_job',
  'wrong_number',
  'other',
] as const;

export const reviewOutputSchema = z.object({
  issues: z.array(
    z.object({
      item: z.string().max(32).describe('the id in brackets, for example job.2.3'),
      action: z.enum(['fix', 'ask']),
      class: z.enum(REVIEW_CLASSES),
      text: z
        .string()
        .max(LIMITS.maxTextChars)
        .nullable()
        .describe(
          'fix: the corrected text or value; ask: the item as it would read if true, or null',
        ),
      segments: z
        .array(z.string().max(16))
        .max(LIMITS.maxFactIds)
        .describe('fix: ids of the segments the corrected text rests on'),
      question: z
        .string()
        .max(LIMITS.maxFieldChars)
        .nullable()
        .describe('ask: the question to the person, in the language of the CV'),
    }),
  ),
});
export type ReviewOutput = z.infer<typeof reviewOutputSchema>;
export type ReviewIssue = ReviewOutput['issues'][number];

/**
 * What one id of the review stands for: a text item, the title of a group of items, a field of a job,
 * a school or an extra entry, or a skill group.
 */
export type ReviewTarget =
  | { kind: 'item'; item: DraftItem; place: Place; max: number }
  | { kind: 'title'; group: { title: string | null } }
  | { kind: 'field'; job: number; field: 'title' | 'company' | 'location' | 'dates' }
  | { kind: 'education'; entry: number; field: 'institution' | 'degree' | 'dates' }
  | { kind: 'entry'; section: number; entry: number; field: 'title' | 'dates' }
  | { kind: 'skills'; group: number };

/** Where a text item stands, for its question. */
export type Place =
  | { section: 'headline' | 'summary' | 'contacts' }
  /** `group`: the index of the item's group, so a question can target that group alone. */
  | { section: 'experience'; job: number; group?: number }
  | { section: 'additional'; index: number; entry?: number; group?: number };

/** The draft as the reviewer reads it, and what each id it may answer by stands for. */
export interface ReviewView {
  targets: ReadonlyMap<string, ReviewTarget>;
  text: string;
}

const dateRange = (start: string | null, end: string | null, current: boolean) =>
  `${start ?? '?'} – ${current ? 'present' : (end ?? '?')}`;

const cited = (segments: readonly string[]) => segments.join(', ') || 'none';

/** Every piece of the draft in document order; jobs and schools show their fields' ids in one line. */
export function reviewView(draft: Draft): ReviewView {
  const targets = new Map<string, ReviewTarget>();
  const lines: string[] = [];
  const text = (id: string, item: DraftItem | null, place: Place, max: number) => {
    if (!item) return;
    targets.set(id, { kind: 'item', item, place, max });
    lines.push(
      item.kept
        ? `[${id}] (unchanged, from ${cited(item.segments)}) ${JSON.stringify(item.text)}`
        : `[${id}] (rewritten, evidence ${cited(item.segments)}) ${JSON.stringify(item.text)}`,
    );
  };
  // Items are numbered across the groups of one list; a titled group prints its title's id above them.
  const groups = (
    prefix: string,
    list: readonly DraftGroup[],
    place: Extract<Place, { section: 'experience' | 'additional' }>,
    max: number,
  ) => {
    let n = 0;
    list.forEach((group, g) => {
      if (group.title !== null) {
        const id = `${prefix}.g${g + 1}`;
        targets.set(id, { kind: 'title', group });
        lines.push(`[${id}] (group title) ${JSON.stringify(group.title)}:`);
      }
      group.items.forEach((item) => {
        text(`${prefix}.${++n}`, item, { ...place, group: g }, max);
      });
    });
  };
  text('name', draft.fullName, { section: 'contacts' }, LIMITS.maxFieldChars);
  text('location', draft.location, { section: 'contacts' }, LIMITS.maxFieldChars);
  text('headline', draft.headline, { section: 'headline' }, LIMITS.maxFieldChars);
  draft.summary.forEach((item, i) => {
    text(`summary.${i + 1}`, item, { section: 'summary' }, LIMITS.maxSummaryChars);
  });
  // A company block as the template prints it: when only its first position has bullets, they are the
  // company's, so the reviewer sees them after all its titles and does not tie them to one of them.
  const indexed = draft.experience.map((job, i) => ({ ...job, i }));
  for (const group of experienceGroups(indexed)) {
    const shared = sharesBullets(group);
    for (const job of group) {
      const n = `job.${job.i + 1}`;
      for (const field of ['title', 'company', 'location', 'dates'] as const) {
        targets.set(`${n}.${field}`, { kind: 'field', job: job.i, field });
      }
      lines.push(
        `Job ${job.i + 1} (from ${cited(job.segments)}): [${n}.title] ${JSON.stringify(job.title)} · ` +
          `[${n}.company] ${JSON.stringify(job.company)} · [${n}.location] ${JSON.stringify(job.location)} · ` +
          `[${n}.dates] ${dateRange(job.start, job.end, job.current)}`,
      );
      if (shared && job !== group.at(-1)) continue;
      const owner = shared ? group[0] : job;
      if (!owner) continue;
      if (shared) {
        lines.push(`Bullets of the company, shared by jobs ${owner.i + 1}–${job.i + 1}:`);
      }
      groups(
        `job.${owner.i + 1}`,
        owner.groups,
        { section: 'experience', job: owner.i },
        LIMITS.maxBulletChars,
      );
    }
  }
  draft.education.forEach((entry, i) => {
    const n = `edu.${i + 1}`;
    for (const field of ['institution', 'degree', 'dates'] as const) {
      targets.set(`${n}.${field}`, { kind: 'education', entry: i, field });
    }
    lines.push(
      `Education ${i + 1} (from ${cited(entry.segments)}): [${n}.institution] ` +
        `${JSON.stringify(entry.institution)} · [${n}.degree] ${JSON.stringify(entry.degree)} · ` +
        `[${n}.dates] ${dateRange(entry.start, entry.end, false)}`,
    );
  });
  draft.skills.forEach((group, i) => {
    const id = `skills.${i + 1}`;
    targets.set(id, { kind: 'skills', group: i });
    const how = group.kept ? 'unchanged, from' : 'regrouped, evidence';
    // The title is a claim of its own, as in a group of bullets (decision 036).
    if (group.title !== null) {
      targets.set(`${id}.title`, { kind: 'title', group });
      lines.push(`[${id}.title] (group title) ${JSON.stringify(group.title)}:`);
    }
    lines.push(`[${id}] (${how} ${cited(group.segments)}) ${group.items.join(', ')}`);
  });
  draft.additional.forEach((section, i) => {
    lines.push(`Section ${JSON.stringify(section.title)}:`);
    section.entries.forEach((entry, j) => {
      const n = `extra.${i + 1}.${j + 1}`;
      for (const field of ['title', 'dates'] as const) {
        targets.set(`${n}.${field}`, { kind: 'entry', section: i, entry: j, field });
      }
      lines.push(
        `Entry ${i + 1}.${j + 1} (from ${cited(entry.segments)}): [${n}.title] ` +
          `${JSON.stringify(entry.title)} · [${n}.dates] ${dateRange(entry.start, entry.end, false)}`,
      );
      groups(n, entry.groups, { section: 'additional', index: i, entry: j }, LIMITS.maxTextChars);
    });
  });
  return { targets, text: lines.join('\n') };
}

const DATES = /^\s*(\d{4}(?:-\d{2})?|\?)?\s*[–-]\s*(\d{4}(?:-\d{2})?|present|\?)?\s*$/i;

/** "2021-09 – present" as fields; null when the text is not in that form. */
export function parseDates(
  text: string,
): { start: string | null; end: string | null; current: boolean } | null {
  const match = DATES.exec(text);
  if (!match) return null;
  const start = match[1] && match[1] !== '?' ? match[1] : null;
  const current = /^present$/i.test(match[2] ?? '');
  const end = !current && match[2] && match[2] !== '?' ? match[2] : null;
  // The same rule as the document: a month is 01–12.
  if (!dateSchema.safeParse(start).success || !dateSchema.safeParse(end).success) return null;
  return { start, end, current };
}

/**
 * The reviewer's schema for one draft: ids it names exist, a fix cites existing segments and fits the
 * item's limit, and a fixed date reads as dates. Failures go back to the model with the re-ask.
 */
export function reviewSchema(view: ReviewView, index: SegmentIndex) {
  return reviewOutputSchema.superRefine((output, context) => {
    output.issues.forEach((issue, i) => {
      const add = (message: string) => {
        context.addIssue({ code: 'custom', path: ['issues', i], message });
      };
      const target = view.targets.get(issue.item);
      if (!target) {
        add(`Unknown item ${issue.item}`);
        return;
      }
      for (const id of issue.segments) if (!index.has(id)) add(`Unknown segment id ${id}`);
      // A name or a location has no question to ask: what the source does not support is fixed.
      if (issue.action === 'ask' && target.kind === 'item' && target.place.section === 'contacts') {
        add('For the name or the location give a fix, not an ask');
      }
      if (issue.action === 'ask') return;
      if (issue.text === null || issue.text.trim() === '') {
        add('A fix needs the corrected text');
        return;
      }
      if (target.kind === 'item' && issue.text.length > target.max) {
        add(`Longer than ${target.max} characters`);
      }
      // A headline without evidence is the target role; a group title names the items under it.
      const free =
        (target.kind === 'item' && target.place.section === 'headline') || target.kind === 'title';
      if (!free && issue.segments.length === 0) add('A fix must cite its evidence');
      if (
        target.kind !== 'item' &&
        target.kind !== 'skills' &&
        issue.text.length > LIMITS.maxFieldChars
      ) {
        add(`Longer than ${LIMITS.maxFieldChars} characters`);
      }
      const dates = 'field' in target && target.field === 'dates';
      if (dates && !parseDates(issue.text)) add('Write dates as YYYY-MM – YYYY-MM, or present');
    });
  });
}
