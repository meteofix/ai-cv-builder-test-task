import type { Labels } from './labels.js';

/** Text counts as present only when it has something other than spaces (the editor can leave " " behind). */
export const filled = (value: string | null | undefined): value is string => !!value?.trim();

/** `2021-03` → `Mar 2021`, `2021` → `2021`; anything else prints nothing. */
export function formatDate(value: string | null | undefined, labels: Labels): string {
  if (!value) return '';
  const [year = '', month] = value.split('-');
  const name = month ? labels.months[Number(month) - 1] : undefined;
  return [name, year].filter(Boolean).join(' ');
}

/** `Mar 2023 – Present`; one known side prints alone, nothing known prints nothing. */
export function dateRange(
  start: string | null | undefined,
  end: string | null | undefined,
  current: boolean,
  labels: Labels,
): string {
  return [formatDate(start, labels), current ? labels.present : formatDate(end, labels)]
    .filter(Boolean)
    .join(' – ');
}

interface Dated {
  start: string | null;
  end: string | null;
  current: boolean;
}

/**
 * The period of a company block: its earliest start to its latest end, or to "Present" when any of its
 * positions is current. `YYYY` and `YYYY-MM` sort as plain strings, a year before its own months.
 */
export function periodOf(positions: readonly Dated[], labels: Labels): string {
  const starts = positions
    .map((position) => position.start)
    .filter(filled)
    .sort();
  const ends = positions
    .map((position) => position.end)
    .filter(filled)
    .sort();
  const current = positions.some((position) => position.current);
  return dateRange(starts[0], ends.at(-1), current, labels);
}
