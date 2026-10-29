import { dateSchema, LIMITS } from '@cv/shared';
import {
  authorOutputSchema,
  dateOf,
  groupSkills,
  itemText,
  type AuthorGroup,
  type AuthorItem,
} from './author-schema.js';
import type { SegmentIndex } from './verbatim.js';

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
