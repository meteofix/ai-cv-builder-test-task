import {
  bulletsOf,
  cvDocumentSchema,
  experienceGroups,
  sharesBullets,
  splitList,
  type CvAdditionalSection,
  type CvDocument,
  type Locale,
  type NotInCvItem,
} from '@cv/shared';
import { newId } from './prepare';

const FALLBACK_TITLE: Record<Locale, string> = {
  en: 'Additional information',
  uk: 'Додаткова інформація',
};

const key = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();
const sentences = (text: string) =>
  text
    .split(/(?<=[.!?])\s+/)
    .map(key)
    .filter(Boolean);

/**
 * Whether the CV already shows this text, so "Not in your CV" no longer offers it: a bullet, a line or
 * the title of an extra entry equal to it, a sentence of the summary equal to it, or every name of a list among the skills. Whole
 * items only — a short text inside a longer one ("SQL" in "NoSQL") is not shown.
 */
export function shownInCv(document: CvDocument, text: string): boolean {
  const needle = key(text);
  if (needle === '') return true;
  const texts = [
    ...document.experience.flatMap((position) => bulletsOf(position).map((bullet) => bullet.text)),
    ...document.additional.flatMap((section) =>
      section.entries.flatMap((entry) => [
        entry.title,
        ...bulletsOf(entry).map((line) => line.text),
      ]),
    ),
  ].map(key);
  const skills = new Set(
    document.skills.flatMap((group) => group.items.map((skill) => key(skill.name))),
  );
  const names = splitList(text).map(key);
  return (
    key(document.summary.text) === needle ||
    sentences(document.summary.text).includes(needle) ||
    texts.includes(needle) ||
    (names.length > 0 && names.every((name) => skills.has(name)))
  );
}

/** The first position of the company block a position belongs to, when that block shares its bullets. */
function bulletOwner(document: CvDocument, itemId: string | undefined): number {
  const index = document.experience.findIndex((entry) => entry.id === itemId);
  if (index < 0) return index;
  const group = experienceGroups(document.experience).find((block) =>
    block.some((entry) => entry.id === itemId),
  );
  const first = group?.[0];
  return group && first && sharesBullets(group) ? document.experience.indexOf(first) : index;
}

interface Group<T> {
  id: string;
  title: string | null;
  items: T[];
}

/** The groups with the item at the end of the last one, or of a new untitled group when there is none. */
function appendToLast<T>(groups: Group<T>[], item: T): Group<T>[] {
  const last = groups.at(-1);
  if (!last) return [{ id: newId(), title: null, items: [item] }];
  return groups.with(-1, { ...last, items: [...last.items, item] });
}

const newLine = (text: string) => ({ id: newId(), text, factIds: [] });

/**
 * A line of a section: into its last entry when that entry is a plain list (no title, no dates), so lines
 * added one by one stay one list; otherwise a new untitled entry of its own.
 */
function withLine(section: CvAdditionalSection, text: string): CvAdditionalSection {
  const last = section.entries.at(-1);
  if (last && !last.title.trim() && !last.start && !last.end) {
    const entry = { ...last, groups: appendToLast(last.groups, newLine(text)) };
    return { ...section, entries: section.entries.with(-1, entry) };
  }
  const entry = {
    id: newId(),
    title: '',
    start: null,
    end: null,
    groups: appendToLast([], newLine(text)),
  };
  return { ...section, entries: [...section.entries, entry] };
}

function inSkills(document: CvDocument, item: NotInCvItem, text: string): CvDocument | null {
  const names = splitList(text);
  if (names.length === 0) return null;
  const index = document.skills.findIndex((group) => group.id === item.itemId);
  const group = document.skills[index];
  if (!group) {
    const items = names.map((name) => ({ id: newId(), name }));
    return { ...document, skills: [...document.skills, { id: newId(), title: null, items }] };
  }
  // A name the group already has is not repeated.
  const known = new Set(group.items.map((skill) => key(skill.name)));
  const added = names.filter((name) => !known.has(key(name)));
  if (added.length === 0) return null;
  const items = [...group.items, ...added.map((name) => ({ id: newId(), name }))];
  return { ...document, skills: document.skills.with(index, { ...group, items }) };
}

function inAdditional(document: CvDocument, itemId: string | undefined, text: string) {
  const index = document.additional.findIndex((section) => section.id === itemId);
  const section = document.additional[index];
  if (section) {
    return { ...document, additional: document.additional.with(index, withLine(section, text)) };
  }
  for (const [at, owner] of document.additional.entries()) {
    const entryAt = owner.entries.findIndex((entry) => entry.id === itemId);
    const entry = owner.entries[entryAt];
    if (!entry) continue;
    const groups = appendToLast(entry.groups, newLine(text));
    const next = { ...owner, entries: owner.entries.with(entryAt, { ...entry, groups }) };
    return { ...document, additional: document.additional.with(at, next) };
  }
  return null;
}

function inPlace(document: CvDocument, item: NotInCvItem, text: string): CvDocument | null {
  if (item.section === 'experience') {
    const index = bulletOwner(document, item.itemId);
    const position = document.experience[index];
    if (!position) return null;
    const groups = appendToLast(position.groups, { id: newId(), text, factIds: [] });
    return { ...document, experience: document.experience.with(index, { ...position, groups }) };
  }
  if (item.section === 'summary') {
    const summary = document.summary.text.trim();
    const joined = summary ? `${summary} ${text}` : text;
    return { ...document, summary: { ...document.summary, text: joined } };
  }
  if (item.section === 'skills') return inSkills(document, item, text);
  if (item.section === 'additional') return inAdditional(document, item.itemId, text);
  return null;
}

function inFallback(document: CvDocument, text: string): CvDocument {
  const title = FALLBACK_TITLE[document.locale];
  const index = document.additional.findIndex((section) => section.title === title);
  const section = document.additional[index];
  if (section) {
    return { ...document, additional: document.additional.with(index, withLine(section, text)) };
  }
  const added = withLine({ id: newId(), title, entries: [] }, text);
  return { ...document, additional: [...document.additional, added] };
}

/**
 * The document with the item's text added word for word where it belongs (decision 035): a bullet in the
 * last group of its position (of a company block's first position when the block shares its bullets), a
 * sentence of the summary, the names of its skill group (or a new group), a line of its extra entry or
 * section — or, without a place of its own or room there, a line of an extra section. Null when no place can take it within the document's limits: the panel then says
 * so instead of saving a document the server would refuse. Text that looked like an instruction is never
 * added.
 */
export function addFromPanel(document: CvDocument, item: NotInCvItem): CvDocument | null {
  if (item.reason === 'ignored') return null;
  const text = item.text.trim();
  if (text === '') return null;
  for (const candidate of [inPlace(document, item, text), inFallback(document, text)]) {
    if (candidate && cvDocumentSchema.safeParse(candidate).success) return candidate;
  }
  return null;
}
