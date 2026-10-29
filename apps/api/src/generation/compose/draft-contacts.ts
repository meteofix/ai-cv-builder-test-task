import { LIMITS } from '@cv/shared';
import {
  checkEmail,
  checkLink,
  checkPhone,
  inSource,
  telegramLink,
} from '../../grounding/index.js';
import type { AuthorOutput } from './author-schema.js';
import type { DraftItem } from './draft.js';

type Contact = AuthorOutput['contacts'][number];

export interface DraftContacts {
  fullName: DraftItem | null;
  location: DraftItem | null;
  email: string;
  phone: string;
  links: string[];
  /**
   * Segments of the contacts the CV shows or "Not in your CV" lists: they count as placed. A refused
   * contact's segment does not, so a real contact the author miscopied shows as not placed — unless
   * another contact on the same line was accepted: the accounting is by line.
   */
  contactSegments: string[];
  /** Contacts the source has as written that are no web address (a handle): "Not in your CV" lists them. */
  notLinks: string[];
}

/**
 * The contacts of the draft (docs/specs/grounding.md §3): an email, phone or link only as the source
 * writes it; a handle labelled as Telegram as its link; any other handle the source holds for the panel.
 */
export function draftContacts(output: AuthorOutput, source: string): DraftContacts {
  const of = (field: Contact['field']) =>
    output.contacts.filter((contact) => contact.field === field);
  const placed: string[] = [];
  // The name and the location are not matched against their segment: a name may be transliterated or
  // re-cased, so the reviewer checks them as items instead.
  const first = (field: 'fullName' | 'location'): DraftItem | null => {
    const contact = of(field)[0];
    if (!contact) return null;
    placed.push(contact.segment);
    return { text: contact.value.trim(), segments: [contact.segment], kept: false };
  };
  const checked = (
    field: 'email' | 'phone',
    check: (value: string, source: string) => string | null,
  ) => {
    for (const contact of of(field)) {
      const value = check(contact.value, source);
      if (value !== null) {
        placed.push(contact.segment);
        return value;
      }
    }
    return '';
  };
  const links: string[] = [];
  const notLinks: string[] = [];
  for (const contact of of('link')) {
    const link = checkLink(contact.value, source) ?? telegramLink(contact.value, source);
    const list = link !== null ? links : inSource(contact.value, source) ? notLinks : null;
    const value = link ?? contact.value.trim();
    // A repeat of a listed value is shown too; one past the limit is not, so its line is not placed.
    if (list && (list.includes(value) || list.length < LIMITS.maxLinks)) {
      if (!list.includes(value)) list.push(value);
      placed.push(contact.segment);
    }
  }
  return {
    fullName: first('fullName'),
    location: first('location'),
    email: checked('email', checkEmail),
    phone: checked('phone', checkPhone),
    links,
    contactSegments: [...new Set(placed)],
    notLinks,
  };
}
