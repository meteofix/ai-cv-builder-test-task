import type { CvDocument, CvEducation, CvPosition } from '@cv/shared';

function byId<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

/** The client's `factId` is dropped; the stored one is put back only if the item is unchanged. */
function withoutFactId<T extends { factId?: string }>(item: T): Omit<T, 'factId'> {
  const copy = { ...item };
  delete copy.factId;
  return copy;
}

/** An absent optional field and an empty one both mean "nothing here"; they are not an edit. */
const same = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '') === (b ?? '');

function positionUnchanged(stored: CvPosition, edited: CvPosition): boolean {
  return (
    same(stored.company, edited.company) &&
    same(stored.title, edited.title) &&
    same(stored.location, edited.location) &&
    same(stored.start, edited.start) &&
    same(stored.end, edited.end) &&
    stored.current === edited.current
  );
}

function educationUnchanged(stored: CvEducation, edited: CvEducation): boolean {
  return (
    same(stored.institution, edited.institution) &&
    same(stored.degree, edited.degree) &&
    same(stored.start, edited.start) &&
    same(stored.end, edited.end)
  );
}

/** Keeps the stored fact ids of a text the user did not touch; a new or changed text starts with none. */
function carryFactIds<T extends { id: string; text: string }>(
  stored: T | undefined,
  edited: T,
  storedFactIds: (item: T) => string[],
): string[] {
  return stored && stored.text === edited.text ? storedFactIds(stored) : [];
}

/**
 * Applies the server-owned provenance to a document the user edited. `factIds` and `factId` link the
 * CV to the source facts; the client may not set them, so each one is taken from the stored document and
 * only while the text or fields it vouches for are unchanged. This is how the generation module tells
 * a bullet the user wrote (`factIds: []`) from one the AI wrote and the checks have verified.
 */
export function withServerProvenance(stored: CvDocument, edited: CvDocument): CvDocument {
  const storedPositions = byId(stored.experience);
  const storedEducation = byId(stored.education);
  const storedSkills = byId(stored.skills);
  const storedSections = byId(stored.additional);

  return {
    ...edited,
    summary: {
      text: edited.summary.text,
      factIds: stored.summary.text === edited.summary.text ? stored.summary.factIds : [],
    },
    experience: edited.experience.map((position) => {
      const before = storedPositions.get(position.id);
      const storedBullets = byId(before?.bullets ?? []);
      return {
        ...withoutFactId(position),
        ...(before?.factId && positionUnchanged(before, position) ? { factId: before.factId } : {}),
        // A bullet is looked up inside its own position: a fact of another job must not follow it.
        bullets: position.bullets.map((bullet) => ({
          ...bullet,
          factIds: carryFactIds(storedBullets.get(bullet.id), bullet, (b) => b.factIds),
        })),
      };
    }),
    education: edited.education.map((entry) => {
      const before = storedEducation.get(entry.id);
      return {
        ...withoutFactId(entry),
        ...(before?.factId && educationUnchanged(before, entry) ? { factId: before.factId } : {}),
      };
    }),
    skills: edited.skills.map((skill) => {
      const before = storedSkills.get(skill.id);
      return {
        ...withoutFactId(skill),
        ...(before?.factId && before.name === skill.name ? { factId: before.factId } : {}),
      };
    }),
    additional: edited.additional.map((section) => {
      const storedItems = byId(storedSections.get(section.id)?.items ?? []);
      return {
        ...section,
        items: section.items.map((item) => ({
          ...item,
          factIds: carryFactIds(storedItems.get(item.id), item, (i) => i.factIds),
        })),
      };
    }),
  };
}
