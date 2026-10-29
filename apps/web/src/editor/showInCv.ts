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
  // A group the person has removed falls back to its job or entry; a field has no element of its own,
  // so its section is the closest target.
  const ids = target.itemId ? [target.itemId, target.itemId.replace(/-g\d+$/, '')] : [];
  const item = ids.map((id) => document.getElementById(`item-${id}`)).find(Boolean) ?? null;
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

/** Whether a question's target is this job or entry, or one of its groups (`p1-g2` belongs to `p1`). */
export function concerns(
  target: { section: string; itemId?: string | undefined } | null | undefined,
  section: QuestionTarget['section'],
  id: string,
): boolean {
  if (target?.section !== section || target.itemId === undefined) return false;
  return target.itemId === id || target.itemId.startsWith(`${id}-g`);
}
