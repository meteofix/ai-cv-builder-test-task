export const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** `2021-03` → month `03`, year `2021`; `2021` → no month; nothing → both empty. */
export function splitDate(value: string | null | undefined): { month: string; year: string } {
  const [year = '', month = ''] = (value ?? '').split('-');
  return { month, year };
}

/** A month without a year is not a date: the year decides, the month refines it. */
export function joinDate(month: string, year: string): string | null {
  if (!year) return null;
  return month ? `${year}-${month}` : year;
}

export function formatDate(value: string | null | undefined): string {
  const { month, year } = splitDate(value);
  const name = month ? MONTH_NAMES[Number(month) - 1] : undefined;
  return [name, year].filter(Boolean).join(' ');
}

/** The one-line range of a card header: `Mar 2023 – Present`; empty when nothing is known. */
export function formatRange(
  start: string | null | undefined,
  end: string | null | undefined,
  current = false,
): string {
  const from = formatDate(start);
  const to = current ? 'Present' : formatDate(end);
  return [from, to].filter(Boolean).join(' – ');
}

/** Years offered by the selects: a few years ahead (a degree still in progress) back to 1970, plus a stored year outside that. */
export function yearOptions(stored: string): string[] {
  const latest = new Date().getFullYear() + 10;
  const years = Array.from({ length: latest - 1970 + 1 }, (_, i) => String(latest - i));
  return stored && !years.includes(stored) ? [stored, ...years] : years;
}
