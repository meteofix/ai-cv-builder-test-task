import { z } from 'zod';
import { LIMITS } from './limits.js';
import { localeSchema } from './locale.js';

const id = z.string().min(1).max(64);
const field = z.string().max(LIMITS.maxFieldChars);
const factIds = z.array(id).max(LIMITS.maxFactIds);

/** `YYYY` or `YYYY-MM`; a missing date is `null`, never an empty string. */
export const dateSchema = z
  .string()
  .regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/, 'Use YYYY or YYYY-MM')
  .nullable();

/** Only http(s), mailto and tel links reach the template, so a CV cannot carry a `javascript:` URL. */
export const linkSchema = z
  .string()
  .max(LIMITS.maxFieldChars)
  .refine(
    (value) =>
      URL.canParse(value) &&
      ['http:', 'https:', 'mailto:', 'tel:'].includes(new URL(value).protocol),
    'Use an http(s), mailto or tel link',
  );

const bulletSchema = z.object({
  id,
  text: z.string().max(LIMITS.maxBulletChars),
  factIds,
});

/**
 * The one building block of the document's lists (decision 036): a group of items with an optional title
 * ("Platform & backend", "Cloud"). One group without a title is a plain list. One level only: a group
 * holds items, never groups.
 */
function groupOf<T extends z.ZodType>(item: T) {
  return z.object({ id, title: field.nullable(), items: z.array(item) });
}

const bulletGroupSchema = groupOf(bulletSchema);

const positionSchema = z
  .object({
    id,
    factId: id.optional(),
    company: field,
    title: field,
    location: field.optional(),
    start: dateSchema,
    end: dateSchema,
    current: z.boolean(),
    groups: z.array(bulletGroupSchema).max(LIMITS.maxGroupsPerList),
  })
  .refine((position) => !(position.current && position.end !== null), {
    message: 'A current position has no end date',
    path: ['end'],
  })
  .refine((position) => bulletsOf(position).length <= LIMITS.maxBulletsPerPosition, {
    message: `At most ${LIMITS.maxBulletsPerPosition} bullets in a position`,
    path: ['groups'],
  });

const educationSchema = z.object({
  id,
  factId: id.optional(),
  institution: field,
  degree: field.optional(),
  start: dateSchema.optional(),
  end: dateSchema.optional(),
});

const skillSchema = z.object({ id, name: field, factId: id.optional() });

/** A group of skills as the CV shows it ("Cloud: AWS, GCP"); `title: null` is a list without a label. */
const skillGroupSchema = groupOf(skillSchema);

const lineSchema = z.object({ id, text: z.string().max(LIMITS.maxTextChars), factIds });

/** One record of an extra section: a project, a course, a certificate — a title, dates and groups of lines. */
const entrySchema = z
  .object({
    id,
    title: field,
    start: dateSchema,
    end: dateSchema,
    groups: z.array(groupOf(lineSchema)).max(LIMITS.maxGroupsPerList),
  })
  .refine((entry) => bulletsOf(entry).length <= LIMITS.maxLinesPerEntry, {
    message: `At most ${LIMITS.maxLinesPerEntry} lines in an entry`,
    path: ['groups'],
  });

const additionalSectionSchema = z.object({
  id,
  title: field,
  entries: z.array(entrySchema).max(LIMITS.maxAdditionalItems),
});

export const cvDocumentSchema = z
  .object({
    locale: localeSchema,
    contacts: z.object({
      fullName: field,
      email: field,
      phone: field,
      location: field,
      links: z.array(linkSchema).max(LIMITS.maxLinks),
    }),
    headline: field,
    summary: z.object({ text: z.string().max(LIMITS.maxSummaryChars), factIds }),
    experience: z.array(positionSchema).max(LIMITS.maxExperience),
    education: z.array(educationSchema).max(LIMITS.maxEducation),
    skills: z.array(skillGroupSchema).max(LIMITS.maxSkillGroups),
    additional: z.array(additionalSectionSchema).max(LIMITS.maxAdditionalSections),
  })
  .superRefine((document, context) => {
    const skills = document.skills.reduce((sum, group) => sum + group.items.length, 0);
    // Items keep their provenance by id when they move between the groups of one list.
    const unique = (
      path: (string | number)[],
      groups: readonly { items: readonly { id: string }[] }[],
    ) => {
      const seen = new Set<string>();
      groups.forEach((group, i) => {
        group.items.forEach((item, j) => {
          if (seen.has(item.id)) {
            context.addIssue({
              code: 'custom',
              message: 'Duplicate id',
              path: [...path, i, 'items', j, 'id'],
            });
          }
          seen.add(item.id);
        });
      });
    };
    document.experience.forEach((position, i) => {
      unique(['experience', i, 'groups'], position.groups);
    });
    document.additional.forEach((section, i) => {
      section.entries.forEach((entry, j) => {
        unique(['additional', i, 'entries', j, 'groups'], entry.groups);
      });
    });
    unique(['skills'], document.skills);
    if (skills > LIMITS.maxSkills) {
      context.addIssue({
        code: 'custom',
        message: `At most ${LIMITS.maxSkills} skills`,
        path: ['skills'],
      });
    }
    // Provenance carry-over, question targets, reordering and React keys all address items by id.
    type IdList = [path: (string | number)[], items: { id: string }[]];
    const lists: IdList[] = [
      [['experience'], document.experience],
      [['education'], document.education],
      [['skills'], document.skills],
      [['additional'], document.additional],
      ...document.experience.map((position, i): IdList => [
        ['experience', i, 'groups'],
        position.groups,
      ]),
      ...document.additional.map((section, i): IdList => [
        ['additional', i, 'entries'],
        section.entries,
      ]),
    ];
    for (const [path, items] of lists) {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        if (seen.has(item.id)) {
          context.addIssue({
            code: 'custom',
            message: 'Duplicate id',
            path: [...path, index, 'id'],
          });
        }
        seen.add(item.id);
      });
    }
  });

export type CvDocument = z.infer<typeof cvDocumentSchema>;
export type CvPosition = z.infer<typeof positionSchema>;
export type CvEducation = z.infer<typeof educationSchema>;
export type CvSkill = z.infer<typeof skillSchema>;
export type CvSkillGroup = z.infer<typeof skillGroupSchema>;
export type CvBullet = z.infer<typeof bulletSchema>;
export type CvBulletGroup = z.infer<typeof bulletGroupSchema>;
export type CvEntry = z.infer<typeof entrySchema>;
export type CvAdditionalSection = z.infer<typeof additionalSectionSchema>;

/**
 * Consecutive positions of one company, as the CV shows them: one block per company, its positions in
 * document order. A company counts as the same when its name matches ignoring case and spacing; a
 * position without a company stands alone.
 */
export function experienceGroups<T extends { company: string }>(experience: readonly T[]): T[][] {
  const key = (company: string) => company.trim().replace(/\s+/g, ' ').toLowerCase();
  const groups: T[][] = [];
  for (const position of experience) {
    const last = groups.at(-1);
    const previous = last?.at(-1);
    if (
      last &&
      previous &&
      key(position.company) !== '' &&
      key(previous.company) === key(position.company)
    ) {
      last.push(position);
    } else {
      groups.push([position]);
    }
  }
  return groups;
}

/** Every bullet of a position, group after group. */
export function bulletsOf<T>(position: { groups: readonly { items: readonly T[] }[] }): T[] {
  return position.groups.flatMap((group) => group.items);
}

/**
 * Whether a block of positions shows its bullets for the whole company: only its first position has
 * bullets (the server puts bullets the positions share there). The template and the questions use this
 * one rule; a block where another position has bullets shows each position's own.
 */
export function sharesBullets(
  group: readonly { groups: readonly { items: readonly { text: string }[] }[] }[],
): boolean {
  const filled = (position: { groups: readonly { items: readonly { text: string }[] }[] }) =>
    bulletsOf(position).some((bullet) => bullet.text.trim() !== '');
  const [first, ...rest] = group;
  return first !== undefined && rest.length > 0 && filled(first) && !rest.some(filled);
}
