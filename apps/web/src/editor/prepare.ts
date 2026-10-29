import type { CvDocument, CvEntry } from '@cv/shared';

const emptyToUndefined = (value: string | undefined): string | undefined =>
  value === '' ? undefined : value;

/** A card the person added and has not filled in yet is not part of the CV. */
function isBlankPosition(position: CvDocument['experience'][number]): boolean {
  return (
    !position.title.trim() &&
    !position.company.trim() &&
    !position.location?.trim() &&
    !position.start &&
    !position.end &&
    !position.current &&
    position.groups.length === 0
  );
}

function isBlankEntry(entry: CvEntry): boolean {
  return !entry.title.trim() && !entry.start && !entry.end && entry.groups.length === 0;
}

/** The groups of bullets or lines with text; a group with none left is not part of the CV. */
function filledGroups<T extends { text: string }>(
  groups: readonly { id: string; title: string | null; items: T[] }[],
): { id: string; title: string | null; items: T[] }[] {
  return groups
    .map((group) => ({
      ...group,
      title: group.title?.trim() ? group.title : null,
      items: group.items.filter((item) => item.text.trim()),
    }))
    .filter((group) => group.items.length > 0);
}

function isBlankEducation(entry: CvDocument['education'][number]): boolean {
  return !entry.institution.trim() && !entry.degree?.trim() && !entry.start && !entry.end;
}

/**
 * What is saved and previewed: the form without its empty rows. A new link, bullet, group or card exists in
 * the form from the moment it is added, but it only becomes part of the CV (and an edit to autosave) once it
 * has text.
 */
export function prepareDocument(values: CvDocument): CvDocument {
  const additional = values.additional
    .map((section) => ({
      ...section,
      entries: section.entries
        .map((entry) => ({ ...entry, groups: filledGroups(entry.groups) }))
        .filter((entry) => !isBlankEntry(entry)),
    }))
    .filter((section) => section.title.trim() || section.entries.length > 0);
  return {
    ...values,
    contacts: { ...values.contacts, links: values.contacts.links.filter((link) => link.trim()) },
    experience: values.experience
      .map((position) => ({
        ...position,
        // An optional field the person left empty is absent, as it is in a document that never had it:
        // the inputs of the form start at '' and must not make an untouched CV look edited.
        location: emptyToUndefined(position.location),
        groups: filledGroups(position.groups),
      }))
      .filter((position) => !isBlankPosition(position)),
    education: values.education
      .filter((entry) => !isBlankEducation(entry))
      .map((entry) => ({ ...entry, degree: emptyToUndefined(entry.degree) })),
    skills: values.skills
      .map((group) => ({
        ...group,
        title: groupTitle(group.title),
        items: group.items.filter((skill) => skill.name.trim()),
      }))
      .filter((group) => group.items.length > 0),
    additional,
  };
}

/** A blank title is none; "Cloud:" loses its colon, which the template adds itself. */
function groupTitle(title: string | null): string | null {
  const trimmed = (title ?? '').trim().replace(/:+$/, '').trim();
  return trimmed === '' ? null : trimmed;
}

export const serialize = (document: CvDocument): string =>
  JSON.stringify(prepareDocument(document));

export function newId(): string {
  return crypto.randomUUID();
}
