import { dateSchema } from '@cv/shared';
import { z } from 'zod';

/**
 * What a person reading the CV expects the app to find, written by hand from the rendered pages (not
 * from the app's output) in `<expected dir>/<file name without extension>.md`, inside a fenced json
 * block. The corpus and these files live outside the repository.
 */
export const expectedSchema = z.object({
  positions: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      start: dateSchema,
      end: dateSchema,
      current: z.boolean().optional(),
      /** Bullets of this position alone. */
      bullets: z.number().int().nonnegative(),
      /** Consecutive positions of one company that share bullets. */
      group: z.string().optional(),
    }),
  ),
  /** Bullets a group's positions share, by group name. */
  groupBullets: z.record(z.string(), z.number().int().nonnegative()).default({}),
  skills: z.number().int().nonnegative(),
  contacts: z.array(z.enum(['fullName', 'email', 'phone', 'location', 'link'])),
  education: z.number().int().nonnegative(),
  /** Items of extra sections (courses, languages, projects …), roughly. */
  other: z.number().int().nonnegative(),
});
export type Expected = z.infer<typeof expectedSchema>;

const JSON_BLOCK = /```json\s*\n([\s\S]*?)\n```/;

/** The expectation in a markdown file; a file without a json block expects nothing in particular. */
export function parseExpected(markdown: string): Expected | null {
  const block = JSON_BLOCK.exec(markdown)?.[1];
  if (block === undefined) return null;
  // Written by hand by the person running the eval: a broken file should stop the run loudly.
  return expectedSchema.parse(JSON.parse(block));
}

/** Expected bullets in total: per-position bullets plus every group's shared bullets. */
export function expectedBullets(expected: Expected): number {
  const own = expected.positions.reduce((sum, position) => sum + position.bullets, 0);
  const shared = Object.values(expected.groupBullets).reduce((sum, count) => sum + count, 0);
  return own + shared;
}
