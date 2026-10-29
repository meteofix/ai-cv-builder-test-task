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
    bullets: z.array(bulletSchema).max(LIMITS.maxBulletsPerPosition),
  })
  .refine((position) => !(position.current && position.end !== null), {
    message: 'A current position has no end date',
    path: ['end'],
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

const additionalSectionSchema = z.object({
  id,
  title: field,
  items: z
    .array(z.object({ id, text: z.string().max(LIMITS.maxTextChars), factIds }))
    .max(LIMITS.maxAdditionalItems),
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
    skills: z.array(skillSchema).max(LIMITS.maxSkills),
    additional: z.array(additionalSectionSchema).max(LIMITS.maxAdditionalSections),
  })
  .superRefine((document, context) => {
    // Provenance carry-over, question targets, reordering and React keys all address items by id.
    type IdList = [path: (string | number)[], items: { id: string }[]];
    const lists: IdList[] = [
      [['experience'], document.experience],
      [['education'], document.education],
      [['skills'], document.skills],
      [['additional'], document.additional],
      ...document.experience.map((position, i): IdList => [
        ['experience', i, 'bullets'],
        position.bullets,
      ]),
      ...document.additional.map((section, i): IdList => [
        ['additional', i, 'items'],
        section.items,
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

/**
 * Whether a block of positions shows its bullets for the whole company: only its first position has
 * bullets (the server puts bullets the positions share there). The template and the questions use this
 * one rule; a block where another position has bullets shows each position's own.
 */
export function sharesBullets(group: readonly { bullets: readonly { text: string }[] }[]): boolean {
  const filled = (position: { bullets: readonly { text: string }[] }) =>
    position.bullets.some((bullet) => bullet.text.trim() !== '');
  const [first, ...rest] = group;
  return first !== undefined && rest.length > 0 && filled(first) && !rest.some(filled);
}
