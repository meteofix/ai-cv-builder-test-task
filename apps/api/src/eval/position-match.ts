import type { Expected } from './expected.js';

/** A position as the eval compares it, read from the generated document. */
export interface FoundPosition {
  id: string;
  company: string;
  title: string;
  start: string | null;
  end: string | null;
  current: boolean;
  /** Bullets or achievements counted for this position. */
  bullets: number;
}

export interface PositionMatch {
  expected: Expected['positions'][number];
  found: FoundPosition | null;
  companyOk: boolean;
  titleOk: boolean;
  datesOk: boolean;
}

/** Letters and digits only, lower-cased: "Acme (North)" and "acme north" are one key. */
export function key(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Equal keys, or one containing the other (at least 4 characters): "Acme" pairs with "Acme Corp". Lenient
 * on purpose, so a shortened company still pairs; a title that lost a prefix ("Engineer" for "Senior
 * Engineer") pairs too, which the per-position details make visible.
 */
function similar(a: string, b: string): boolean {
  const [x, y] = [key(a), key(b)];
  if (x === '' || y === '') return x === y;
  return x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)));
}

function datesOk(expected: Expected['positions'][number], found: FoundPosition): boolean {
  const start = found.start === expected.start;
  if (expected.current) return start && found.current;
  return start && found.end === expected.end;
}

/**
 * Pairs each expected position with the first unpaired found position of the same title (and company
 * when it has one), in source order. A position without a title in the source is paired by company.
 */
export function matchPositions(
  expected: Expected['positions'],
  found: readonly FoundPosition[],
): PositionMatch[] {
  const used = new Set<string>();
  return expected.map((position) => {
    const candidate = found.find((item) => {
      if (used.has(item.id)) return false;
      if (position.title === '') return similar(item.company, position.company);
      return (
        similar(item.title, position.title) &&
        (item.company === '' || similar(item.company, position.company))
      );
    });
    if (!candidate) {
      return { expected: position, found: null, companyOk: false, titleOk: false, datesOk: false };
    }
    used.add(candidate.id);
    return {
      expected: position,
      found: candidate,
      companyOk: similar(candidate.company, position.company),
      titleOk: position.title === '' || similar(candidate.title, position.title),
      datesOk: datesOk(position, candidate),
    };
  });
}
