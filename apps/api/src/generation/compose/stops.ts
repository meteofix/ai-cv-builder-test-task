import { LIMITS, type CvDocument } from '@cv/shared';

// A bullet ends either in a full stop or bare (a word, a number, a bracket, a quote, a percent sign).
// One ending in "…", "!", "?", ":" or an ellipsis is neither and is left as it is. Known limits, rare in
// bullets: a final abbreviation ("etc.") loses its dot, and a quote closed after a stop gets another.
// Lines of extra entries are not bullets ("English — C1") and keep their own punctuation.
const STOP = /[^.]\.$/;
const BARE = /[\p{L}\p{N})\]%"'”»]$/u;

/**
 * The bullets with one ending style: kept items carry the source's full stops and rewritten ones
 * usually do not, so a CV would mix both. The style most bullets already have wins; a tie goes bare.
 * Only the final full stop changes, so a bullet says exactly what it said before.
 */
export function alignStops(document: CvDocument): CvDocument {
  const texts = document.experience.flatMap((position) =>
    position.groups.flatMap((group) => group.items.map((item) => item.text.trimEnd())),
  );
  const stops = texts.filter((text) => STOP.test(text)).length;
  const bare = texts.filter((text) => BARE.test(text)).length;
  const withStop = stops > bare;
  const align = (text: string) => {
    const trimmed = text.trimEnd();
    if (withStop && BARE.test(trimmed) && trimmed.length < LIMITS.maxBulletChars) {
      return `${trimmed}.`;
    }
    if (!withStop && STOP.test(trimmed)) return trimmed.slice(0, -1);
    return text;
  };
  return {
    ...document,
    experience: document.experience.map((position) => ({
      ...position,
      groups: position.groups.map((group) => ({
        ...group,
        items: group.items.map((item) => ({ ...item, text: align(item.text) })),
      })),
    })),
  };
}
