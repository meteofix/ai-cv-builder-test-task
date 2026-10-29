import { ADVISED_PAGES, pagesLabel } from './pages';

/**
 * How many pages the PDF will roughly have, next to the preview it is measured from. Over the advised two it
 * is a warning, not a block: the length of the CV is the person's call.
 */
export function PageCount({ pages }: { pages: number | null }) {
  if (pages === null) return null;
  const long = pages > ADVISED_PAGES;
  return (
    <span className={long ? 'page-count page-count--long' : 'page-count'} role="status">
      {pagesLabel(pages)}
    </span>
  );
}
