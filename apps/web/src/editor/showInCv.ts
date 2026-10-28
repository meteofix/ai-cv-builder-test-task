import type { QuestionTarget } from '@cv/shared';

/** The section ids of the form; `additional` is "More" in the section bar. */
export const SECTION_IDS = {
  contacts: 'section-contacts',
  headline: 'section-headline',
  summary: 'section-summary',
  experience: 'section-experience',
  education: 'section-education',
  skills: 'section-skills',
  additional: 'section-more',
} as const;

const FLASH_MS = 2000;

/** Scrolls to the part of the CV a question is about, opens its card and highlights it for a moment. */
export function showInCv(target: QuestionTarget): void {
  // A bullet or a field has no element of its own: its section is the closest target.
  const item = target.itemId ? document.getElementById(`item-${target.itemId}`) : null;
  const element = item ?? document.getElementById(SECTION_IDS[target.section]);
  if (!element) return;
  const card = element.closest('details');
  if (card) card.open = true;
  element.scrollIntoView({ block: 'center' });
  element.setAttribute('data-flash', '');
  setTimeout(() => {
    element.removeAttribute('data-flash');
  }, FLASH_MS);
}
