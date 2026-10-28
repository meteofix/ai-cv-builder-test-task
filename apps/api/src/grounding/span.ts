/** `[start, end)` offsets in the original source text. */
export type Span = readonly [start: number, end: number];

export function overlaps(a: Span, b: Span): boolean {
  return a[0] < b[1] && b[0] < a[1];
}
