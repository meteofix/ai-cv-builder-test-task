/// <reference lib="dom" />
/**
 * Places the page breaks of the PDF before it is printed (docs/specs/cv-template.md, behaviour 10): a page
 * that starts inside a job gets a line "<Company> — continued", which only works when we know where the
 * page starts, so this decides it. It measures the CV at the printed width, walks its smallest blocks in
 * order and, where one would pass the page, forces a break before it (or before the heading kept with
 * it). Every page is then shorter than the printable area by our measure, so Chromium breaks nowhere
 * else. Runs inside the page through `page.evaluate`: self-contained, no imports.
 */
export function paginate(pageHeight: number): void {
  // Margins at a forced break and rounding differ a little between the measure and the print.
  const SLACK = 8;
  const BLOCKS = new Set(['block', 'list-item', 'flex', 'grid', 'table']);
  const root = document.querySelector<HTMLElement>('.cv');
  if (!root) return;

  const isBlock = (element: Element) => BLOCKS.has(getComputedStyle(element).display);
  /** The smallest blocks of the CV in document order: they are never split by our breaks. */
  const units = (): HTMLElement[] => {
    const out: HTMLElement[] = [];
    // A flex or grid row (a job's title with its dates) is one block: its items share a line.
    const ROWS = new Set(['flex', 'grid', 'table']);
    const walk = (element: HTMLElement) => {
      const children = [...element.children].filter(
        (child): child is HTMLElement => child instanceof HTMLElement && isBlock(child),
      );
      if (children.length === 0 || ROWS.has(getComputedStyle(element).display)) out.push(element);
      else children.forEach(walk);
    };
    walk(root);
    return out.filter((element) => element.getBoundingClientRect().height > 0);
  };
  const top = (element: Element) => element.getBoundingClientRect().top;
  const bottom = (element: Element) => element.getBoundingClientRect().bottom;

  /** The outermost block that starts with `unit`, below `limit`: what a break before `unit` goes before. */
  const startOf = (unit: HTMLElement, limit: Element): HTMLElement => {
    let start = unit;
    while (start.parentElement && start.parentElement !== limit) {
      const parent = start.parentElement;
      const first = [...parent.children].find((child) => isBlock(child));
      if (first !== start) break;
      start = parent;
    }
    return start;
  };
  /** A heading the CSS keeps with what follows it (`break-after: avoid`) moves to the next page too. */
  const keptWithNext = (unit: HTMLElement): boolean => {
    for (let element: HTMLElement | null = unit; element && element !== root;) {
      if (getComputedStyle(element).breakAfter === 'avoid') return true;
      const parent: HTMLElement | null = element.parentElement;
      const blocks = parent ? [...parent.children].filter((child) => isBlock(child)) : [];
      if (blocks.at(-1) !== element) return false;
      element = parent;
    }
    return false;
  };
  /** A block the CSS keeps whole (`break-inside: avoid`) that `unit` is inside of, if any. */
  const unbreakable = (unit: HTMLElement): HTMLElement | null => {
    let found: HTMLElement | null = null;
    for (
      let element = unit.parentElement;
      element && element !== root;
      element = element.parentElement
    ) {
      if (getComputedStyle(element).breakInside === 'avoid') found = element;
    }
    return found;
  };

  /** Splits the list `item` stands in, so `item` starts a list of its own; returns that list. */
  const splitList = (item: HTMLElement): HTMLElement => {
    const list = item.parentElement;
    if (!list || item.tagName !== 'LI' || list.firstElementChild === item) return item;
    const rest = list.cloneNode(false) as HTMLElement;
    for (let next: Element | null = item; next;) {
      const following: Element | null = next.nextElementSibling;
      rest.append(next);
      next = following;
    }
    list.after(rest);
    return rest;
  };

  /** Forces a page to start at `unit`: a "continued" line inside a job that began earlier, else a break. */
  const breakBefore = (unit: HTMLElement, units: readonly HTMLElement[]): void => {
    const job = unit.closest<HTMLElement>('[data-continued]');
    const started = job && units.find((candidate) => job.contains(candidate)) !== unit;
    const at = startOf(splitList(unit), job && started ? job : root);
    const marker = document.createElement(started ? 'p' : 'div');
    marker.style.breakBefore = 'page';
    if (job && started) {
      marker.className = 'cv-entry__continued';
      marker.textContent = job.dataset.continued ?? '';
    }
    at.before(marker);
  };

  let list = units();
  const at = (index: number): HTMLElement => {
    const unit = list[index];
    if (!unit) throw new Error(`No block ${index}`);
    return unit;
  };
  let pageTop = list.length > 0 ? top(at(0)) : 0;
  // The first block of the current page, after its "continued" line if it has one.
  let pageStart = 0;
  for (let i = 0; i < list.length; i++) {
    const unit = at(i);
    if (bottom(unit) - pageTop <= pageHeight - SLACK) continue;
    // Taller than a page on its own: nothing to gain by moving it.
    if (bottom(unit) - top(unit) > pageHeight - SLACK) continue;
    let own = i;
    const whole = unbreakable(unit);
    if (whole) own = list.findIndex((candidate) => whole.contains(candidate));
    let first = own;
    while (first > pageStart && keptWithNext(at(first - 1))) first--;
    // Reaching the page's own first block means what is kept together is longer than a page: a break
    // there would start the same page again, so it breaks where it overflows.
    if (first <= pageStart) first = own > pageStart ? own : i;
    // The page's first block overflows only below a "continued" line; Chromium breaks it.
    if (first <= pageStart) continue;
    const breakAt = at(first);
    breakBefore(breakAt, list);
    list = units();
    // The new page starts at the "continued" line, or at the block itself.
    const start = list.indexOf(breakAt);
    const continued = start > 0 && at(start - 1).classList.contains('cv-entry__continued');
    i = continued ? start - 1 : start;
    pageStart = start;
    pageTop = top(at(i));
  }
}
