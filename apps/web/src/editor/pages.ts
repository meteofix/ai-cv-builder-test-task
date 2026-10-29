import { PAGE_CONTENT_HEIGHT_PX, PAGE_MARGIN_MM } from '@cv/cv-template';

/**
 * An estimate of how many A4 pages the PDF will have, from the preview. The PDF is A4 with the template's
 * `@page` margin; on screen the same template draws the page as one `.cv` sheet padded by that margin, so
 * the text column has the printed width and its height divides into printed pages. Breaks the template
 * avoids inside an item can push a little more onto the next page: the number is a hint, never a limit.
 */
const PADDING_PX = 2 * PAGE_MARGIN_MM * (96 / 25.4);

/** The height of the text on one printed page, in CSS pixels (about 994). */
export const PRINTABLE_HEIGHT_PX = PAGE_CONTENT_HEIGHT_PX;

// The sheet's height is rounded to whole pixels; an exactly full page must not count as two.
const ROUNDING_PX = 2;

/** Pages for a sheet of this height (padding included); a sheet that was not laid out has none. */
export function pageCount(sheetHeightPx: number): number | null {
  if (sheetHeightPx <= 0) return null;
  const text = sheetHeightPx - PADDING_PX - ROUNDING_PX;
  return Math.max(1, Math.ceil(text / PRINTABLE_HEIGHT_PX));
}

/** The pages of the preview document, or null while it has no laid-out sheet. */
export function previewPages(page: Document): number | null {
  return pageCount(page.querySelector<HTMLElement>('.cv')?.offsetHeight ?? 0);
}

/** Recruiters usually advise a CV of up to two pages; past that the editor says so. */
export const ADVISED_PAGES = 2;

export function pagesLabel(pages: number): string {
  const count = pages === 1 ? '1 page' : `${pages} pages`;
  return pages > ADVISED_PAGES ? `${count} — recruiters usually advise up to 2` : count;
}
