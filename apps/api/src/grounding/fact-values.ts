import { LIMITS } from '@cv/shared';
import type { ExtractedFact } from './facts.js';
import { indexText, matchQuote } from './find-quote.js';
import type { Span } from './span.js';

/**
 * What can continue an address next to a match, a closed set per kind (docs/specs/grounding.md §2): a
 * neighbour from this set means the match is only part of a longer address. Anything else — whitespace,
 * punctuation, a label's colon, an icon glyph — ends it.
 */
const CONTINUES: Record<'email' | 'link', RegExp> = {
  email: /[\p{L}\p{N}._%+\-@]/u,
  link: /[\p{L}\p{N}._%+\-@/~#?=&]/u,
};
/** What a phone is written with between its digit groups (horizontal whitespace, dots, dashes). */
const PHONE_INNER = /[^\S\r\n\f\v\u2028\u2029]|[.-]/u;
const DIGIT = /\p{N}/u;

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
    const stored = (match.level === 1 ? located.slice(match.span[0], match.span[1]) : value)
      .replace(/\s+/g, ' ')
      .trim();
    // A source slice can be longer than the value the schema allowed (spaced letters, NFD text).
    return stored.length > LIMITS.maxFieldChars ? null : stored;
  };

  /**
   * An address: the exact source text of an occurrence that is a whole address, not a part of a longer
   * one. A phone keeps the `+` or brackets written around its digits; a link keeps the `scheme://` and
   * `www.` written before it and a final `/`.
   */
  const address = (value: string, field: 'email' | 'link' | 'phone'): string | null => {
    const match = matchQuote(index, value, ([start, end]) => {
      const widened = widen(located, start, end, field);
      const whole = wholeAddress(source, span[0] + widened[0], span[0] + widened[1], field);
      return whole ? widened : null;
    });
    if (!match) return null;
    const stored = located.slice(match.span[0], match.span[1]).replace(/\s+/g, ' ');
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
      const stored =
        field === 'email' || field === 'link' || field === 'phone'
          ? address(value, field)
          : display(value);
      return stored === null ? null : { ...fact, contact: { field, value: stored } };
    }
    default:
      return fact;
  }
}

/** The match with the signs written around it that belong to the address. */
function widen(text: string, start: number, end: number, field: 'email' | 'link' | 'phone'): Span {
  let [from, to] = [start, end];
  if (field === 'phone') {
    while (from > 0 && '+('.includes(text[from - 1] ?? '')) from--;
    if (text[to] === ')' && text.slice(from, to).includes('(')) to++;
  }
  if (field === 'link') {
    const prefix = /(?:[a-z][a-z0-9+.-]*:\/\/)?(?:www\.)?$/i.exec(text.slice(0, from))?.[0] ?? '';
    from -= prefix.length;
    if (text[to] === '/' && !CONTINUES.link.test(text[to + 1] ?? ' ')) to++;
  }
  return [from, to];
}

/**
 * Neither neighbour of the match can continue the address (a trailing `.` before whitespace or the end
 * closes a sentence). So `k@example.com` inside `iryna.k@example.com`, `iryna@example.com` inside
 * `iryna@example.com.ua` and `https://github.com/iryna` inside `https://github.com/iryna-k` are not
 * found, while `Email:iryna@example.com` and `+380 50 123 45 67 (Viber)` are. A phone's neighbours are
 * looked at across its own separators: a digit, `+`, a `(` before a digit or a `)` after one continues it.
 */
function wholeAddress(
  source: string,
  start: number,
  end: number,
  field: 'email' | 'link' | 'phone',
): boolean {
  if (field === 'phone') {
    let before = start - 1;
    while (before >= 0 && PHONE_INNER.test(source[before] ?? '')) before--;
    let after = end;
    while (after < source.length && PHONE_INNER.test(source[after] ?? '')) after++;
    const left = source[before] ?? '';
    const right = source[after] ?? '';
    const leftContinues =
      DIGIT.test(left) || left === '+' || (left === ')' && DIGIT.test(source[before - 1] ?? ''));
    const rightContinues =
      DIGIT.test(right) || (right === '(' && DIGIT.test(source[after + 1] ?? ''));
    return !leftContinues && !rightContinues;
  }
  const continues = CONTINUES[field];
  const left = source[start - 1];
  const right = source[end];
  const sentenceEnd = right === '.' && !continues.test(source[end + 1] ?? ' ');
  const leftContinues = left !== undefined && continues.test(left);
  const rightContinues = right !== undefined && continues.test(right) && !sentenceEnd;
  return !leftContinues && !rightContinues;
}
