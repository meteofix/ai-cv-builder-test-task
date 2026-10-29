import type { AuthorOutput } from '../generation/compose/author-schema.js';
import type { PreparedSource } from '../generation/compose/compose.js';
import type { ReviewOutput } from '../generation/compose/review.js';

/**
 * The reviewer test of the eval (decision 035): six inventions of different kinds planted in an author
 * answer the reviewer passed, each at a known item id. Recall is how many of the planted items the
 * reviewer names; on the untouched answer, every finding is a false alarm.
 */

export const PLANT_KINDS = ['technology', 'scope', 'date', 'moved', 'metric', 'unit'] as const;
export type PlantKind = (typeof PLANT_KINDS)[number];

export interface Planted {
  kind: PlantKind;
  /** The review id the reviewer must name. */
  item: string;
}

// Technologies and phrases chosen to be absent from a CV; each candidate is checked against the source.
const TECHNOLOGIES = ['Kubernetes', 'Rust', 'GraphQL', 'Snowflake', 'Kafka', 'Terraform', 'Elixir'];
const SCOPES = [
  'led a team of 12 engineers',
  'owned the company-wide roadmap',
  'managed a budget of $2M',
];

function absent(candidates: readonly string[], source: string): string | null {
  return (
    candidates.find((candidate) => !source.toLowerCase().includes(candidate.toLowerCase())) ?? null
  );
}

/** Jobs with at least one bullet, as `[job index, bullet index]` of their first bullet. */
function bulleted(answer: AuthorOutput): [number, number][] {
  return answer.experience.flatMap((job, i) =>
    job.bullets.length > 0 ? [[i, 0] as [number, number]] : [],
  );
}

// "about 6 hours" → "6 hours": a qualifier dropped makes a claim exact; a unit changed makes it another.
const QUALIFIER = /\b(about|around|approximately|nearly|almost|over|up to|more than|~)\s*(?=\d)/i;
const UNITS: Record<string, string> = {
  ms: 'seconds',
  seconds: 'minutes',
  minutes: 'hours',
  hours: 'days',
  days: 'weeks',
  weeks: 'months',
  months: 'years',
  pairs: 'groups',
  engineers: 'teams',
  developers: 'teams',
  clients: 'countries',
  users: 'companies',
};

/** The text with a changed unit or a dropped qualifier, or null when it has neither. */
function changeUnit(text: string): string | null {
  if (QUALIFIER.test(text)) return text.replace(QUALIFIER, '');
  const match = /(\d[\d,.]*\+?\s+)(?:\w+\s+)?(\w+)/.exec(text);
  const unit = match?.[2]?.toLowerCase();
  if (!match || !unit || !UNITS[unit]) return null;
  return text.replace(match[0], match[0].replace(new RegExp(`${match[2]}$`), UNITS[unit] ?? unit));
}

/**
 * The answer with up to six inventions, one per kind, each on its own item. A kind with nowhere to go
 * (a CV with one job cannot have a moved bullet) is skipped and does not count.
 */
export function plant(
  answer: AuthorOutput,
  source: PreparedSource,
): { answer: AuthorOutput; planted: Planted[] } {
  const copy = structuredClone(answer);
  const planted: Planted[] = [];
  const text = (job: number, bullet: number) => {
    const item = copy.experience[job]?.bullets[bullet];
    if (!item) return '';
    return item.text ?? item.segments.map((id) => source.index.get(id)?.text ?? '').join(' ');
  };
  const rewrite = (job: number, bullet: number, value: string) => {
    const item = copy.experience[job]?.bullets[bullet];
    if (item) item.text = value;
  };
  const free = bulleted(copy);
  const take = () => free.shift();

  const technology = absent(TECHNOLOGIES, source.text);
  const first = take();
  if (technology && first) {
    rewrite(first[0], first[1], `${text(...first).replace(/\.$/, '')} using ${technology}.`);
    planted.push({ kind: 'technology', item: `job.${first[0] + 1}.${first[1] + 1}` });
  }
  const scope = absent(SCOPES, source.text);
  const second = take();
  if (scope && second) {
    rewrite(second[0], second[1], `${text(...second).replace(/\.$/, '')}, and ${scope}.`);
    planted.push({ kind: 'scope', item: `job.${second[0] + 1}.${second[1] + 1}` });
  }
  const dated = copy.experience.findIndex((job) => job.start !== null && /^\d{4}/.test(job.start));
  const job = copy.experience[dated];
  if (job?.start) {
    job.start = `${Number(job.start.slice(0, 4)) - 3}${job.start.slice(4)}`;
    planted.push({ kind: 'date', item: `job.${dated + 1}.dates` });
  }
  // A kept bullet of the first job moved under the last job keeps its words: only its place is wrong.
  const last = copy.experience.length - 1;
  const from = copy.experience[0];
  const moved = from?.bullets.find((bullet, i) => i > 0 && bullet.text === null) ?? null;
  if (last > 0 && from && moved) {
    from.bullets = from.bullets.filter((bullet) => bullet !== moved);
    const target = copy.experience[last];
    if (target) {
      target.bullets.push(moved);
      planted.push({ kind: 'moved', item: `job.${last + 1}.${target.bullets.length}` });
    }
  }
  const third = take();
  if (third) {
    const value = text(...third);
    const number = /\d+/.exec(value);
    const changed = number
      ? value.replace(number[0], String(Number(number[0]) * 3 + 7))
      : `${value.replace(/\.$/, '')}, raising conversion by 35%.`;
    rewrite(third[0], third[1], changed);
    planted.push({ kind: 'metric', item: `job.${third[0] + 1}.${third[1] + 1}` });
  }
  // The unit goes on the first bullet nothing else was planted on that has a number to change.
  const spots = copy.experience.flatMap((entry, i) =>
    entry.bullets.map((_, j) => [i, j] as [number, number]),
  );
  for (const spot of spots) {
    const item = `job.${spot[0] + 1}.${spot[1] + 1}`;
    if (planted.some((plant) => plant.item === item)) continue;
    const changed = changeUnit(text(...spot));
    if (!changed) continue;
    rewrite(spot[0], spot[1], changed);
    planted.push({ kind: 'unit', item });
    break;
  }
  return { answer: copy, planted };
}

/** Which planted items the review names (as fix or ask), and how many findings fall elsewhere. */
export function score(review: ReviewOutput, planted: readonly Planted[]) {
  const named = new Set(review.issues.map((issue) => issue.item));
  const caught = planted.filter((plant) => named.has(plant.item));
  const others = review.issues.filter(
    (issue) => !planted.some((plant) => plant.item === issue.item),
  );
  return {
    caught: caught.map((plant) => plant.kind),
    missed: planted.filter((p) => !caught.includes(p)).map((p) => p.kind),
    others,
  };
}
