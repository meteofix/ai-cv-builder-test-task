import type { CvDocument } from '@cv/shared';

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
    position.bullets.length === 0
  );
}

function isBlankEducation(entry: CvDocument['education'][number]): boolean {
  return !entry.institution.trim() && !entry.degree?.trim() && !entry.start && !entry.end;
}

/**
 * What is saved and previewed: the form without its empty rows. A new link, bullet or card exists in the form
 * from the moment it is added, but it only becomes part of the CV (and an edit to autosave) once it has text.
 */
export function prepareDocument(values: CvDocument): CvDocument {
  const additional = values.additional
    .map((section) => ({ ...section, items: section.items.filter((item) => item.text.trim()) }))
    .filter((section) => section.title.trim() || section.items.length > 0);
  return {
    ...values,
    contacts: { ...values.contacts, links: values.contacts.links.filter((link) => link.trim()) },
    experience: values.experience
      .map((position) => ({
        ...position,
        // An optional field the person left empty is absent, as it is in a document that never had it:
        // the inputs of the form start at '' and must not make an untouched CV look edited.
        location: emptyToUndefined(position.location),
        bullets: position.bullets.filter((bullet) => bullet.text.trim()),
      }))
      .filter((position) => !isBlankPosition(position)),
    education: values.education
      .filter((entry) => !isBlankEducation(entry))
      .map((entry) => ({ ...entry, degree: emptyToUndefined(entry.degree) })),
    skills: values.skills.filter((skill) => skill.name.trim()),
    additional,
  };
}

export const serialize = (document: CvDocument): string =>
  JSON.stringify(prepareDocument(document));

export function newId(): string {
  return crypto.randomUUID();
}
