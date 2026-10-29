import { describe, expect, it } from 'vitest';
import { pageCount, pagesLabel, PRINTABLE_HEIGHT_PX } from './pages';

/** The sheet of the preview for this much text: the text plus the 17 mm padding above and below. */
const PADDING_PX = ((2 * 17) / 25.4) * 96;
const sheet = (textPx: number) => Math.round(textPx + PADDING_PX);

describe('pageCount', () => {
  it.each([
    ['an empty sheet at its A4 minimum height', sheet(PRINTABLE_HEIGHT_PX), 1],
    ['a little text', sheet(300), 1],
    ['text just past one page', sheet(PRINTABLE_HEIGHT_PX + 20), 2],
    ['exactly two pages of text', sheet(2 * PRINTABLE_HEIGHT_PX), 2],
    ['text just past two pages', sheet(2 * PRINTABLE_HEIGHT_PX + 20), 3],
    ['four pages of text', sheet(4 * PRINTABLE_HEIGHT_PX - 50), 4],
  ])('counts %s', (_case, height, pages) => {
    expect(pageCount(height)).toBe(pages);
  });

  it('has no count for a sheet that was not laid out', () => {
    expect(pageCount(0)).toBeNull();
  });

  it('is about 994 px of text per A4 page with 17 mm margins', () => {
    expect(PRINTABLE_HEIGHT_PX).toBeCloseTo(994, 0);
  });
});

describe('pagesLabel', () => {
  it.each([
    [1, '1 page'],
    [2, '2 pages'],
    [3, '3 pages — recruiters usually advise up to 2'],
  ])('says %i as "%s"', (pages, label) => {
    expect(pagesLabel(pages)).toBe(label);
  });
});
