import { LIMITS } from '@cv/shared';
import type { ExtractedFact } from './facts.js';
import { indexText, matchQuote } from './find-quote.js';
import type { Span } from './span.js';

/** Contact fields that are addresses: a part of one is another address, so the whole must match. */
const ADDRESS_FIELDS = new Set(['email', 'link', 'phone']);
/** What may stand next to an address besides whitespace and the edge of the text. A closed set. */
const ADDRESS_SEPARATORS = new Set([',', ';', '(', ')', '<', '>', '"', "'"]);
/** What a phone number is written with between its digits, and what belongs to the number itself. */
const PHONE_INNER = /[ .\-\u00a0]/u;
const PHONE_PART = /[\d+()]/u;

/**
 * The fact with every value checked against the source text at the fact's span (what its quote stands
 * for). A value not found there is cleared, or the fact is dropped when it means nothing without it.
 * Addresses (email, link, phone) are stored as the source writes them and must match whole; display
 * values keep the model's spelling unless the source has it exactly (docs/specs/grounding.md §2).
 */
export function checkValues(fact: ExtractedFact, source: string, span: Span): ExtractedFact | null {
  const located = source.slice(span[0], span[1]);
  const index = indexText(located);

  /** A display value: the source's text on an exact match, the model's when only letters and digits match. */
  const display = (value: string): string | null => {
    const match = matchQuote(index, value);
    if (!match) return null;
    const stored =
      match.level === 1 ? located.slice(match.span[0], match.span[1]).replace(/\s+/g, ' ') : value;
    // A source slice can be longer than the value the schema allowed (spaced letters, NFD text).
    return stored.length > LIMITS.maxFieldChars ? null : stored;
  };

  /** An address: the exact source text, only when it is the whole address and not a part of a longer one. */
  const address = (value: string, field: string): string | null => {
    const match = matchQuote(index, value);
    if (!match) return null;
    let [start, end] = match.span;
    // A letters-and-digits match ends on a digit: a phone keeps the `+` or brackets written around it.
    if (field === 'phone') {
      while (start > 0 && '+('.includes(located[start - 1] ?? '')) start--;
      if (located[end] === ')' && located.slice(start, end).includes('(')) end++;
    }
    if (!wholeAddress(source, span[0] + start, span[0] + end, field === 'phone')) return null;
    const stored = located.slice(start, end).replace(/\s+/g, ' ');
    return stored.length > LIMITS.maxFieldChars ? null : stored;
  };

  const text = (value: string) => display(value) ?? '';
  const optional = (value: string | null) => (value === null ? null : display(value));
  // Months are not checked: only the year has to be in the quote.
  const date = (value: string | null) =>
    value !== null && matchQuote(index, value.slice(0, 4)) !== null ? value : null;

  switch (fact.kind) {
    case 'position': {
      const { company, title, location, start, end, current } = fact.position;
      const verifiedEnd = date(end);
      // "Current" and a verified end date contradict each other, and the quote cannot tell which is
      // right (a year in it may be a promotion): both are dropped, so the dates become a question.
      const conflict = current && verifiedEnd !== null;
      return {
        ...fact,
        position: {
          company: text(company),
          title: text(title),
          location: optional(location),
          start: date(start),
          end: conflict ? null : verifiedEnd,
          current: current && !conflict,
        },
      };
    }
    case 'education': {
      const { institution, degree, start, end } = fact.education;
      return {
        ...fact,
        education: {
          institution: text(institution),
          degree: optional(degree),
          start: date(start),
          end: date(end),
        },
      };
    }
    case 'skill': {
      const name = display(fact.skill.name);
      return name === null ? null : { ...fact, skill: { name } };
    }
    case 'contact': {
      const { field, value } = fact.contact;
      const stored = ADDRESS_FIELDS.has(field) ? address(value, field) : display(value);
      return stored === null ? null : { ...fact, contact: { field, value: stored } };
    }
    default:
      return fact;
  }
}

/**
 * Both ends of an address sit at whitespace, the edge of the text or a separator; a trailing `.` counts
 * only as the end of a sentence (followed by whitespace or the edge). So `k@example.com` inside
 * `iryna.k@example.com` and `iryna@example.com` inside `iryna@example.com.ua` are not found. A phone is
 * written with spaces, dots and dashes inside, so across those its neighbours must not be more of the
 * number (a digit, `+` or a bracket): `123 45 67` is not found inside `+380 50 123 45 67`.
 */
function wholeAddress(source: string, start: number, end: number, phone: boolean): boolean {
  const boundary = (char: string | undefined) =>
    char === undefined || /\s/u.test(char) || ADDRESS_SEPARATORS.has(char);
  const after = source[end];
  const sentenceEnd = after === '.' && boundary(source[end + 1]);
  if (!boundary(source[start - 1]) || !(boundary(after) || sentenceEnd)) return false;
  if (!phone) return true;
  let before = start - 1;
  while (before >= 0 && PHONE_INNER.test(source[before] ?? '')) before--;
  let next = end;
  while (next < source.length && PHONE_INNER.test(source[next] ?? '')) next++;
  return !PHONE_PART.test(source[before] ?? '') && !PHONE_PART.test(source[next] ?? '');
}
