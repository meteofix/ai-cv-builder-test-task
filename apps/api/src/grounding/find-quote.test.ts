import { describe, expect, it } from 'vitest';
import { findQuote, normalizeText } from './find-quote.js';

describe('normalizeText (level 1)', () => {
  it.each(['‐', '‑', '‒', '–', '—', '―', '−'])('maps the dash %j to "-"', (dash) => {
    expect(normalizeText(`2021 ${dash} 2023`)).toBe('2021 - 2023');
  });

  it.each([
    ['‘', "'"],
    ['’', "'"],
    ['‚', "'"],
    ['‛', "'"],
    ['“', '"'],
    ['”', '"'],
    ['„', '"'],
  ])('maps the quote %j to %j', (typographic, ascii) => {
    expect(normalizeText(`a${typographic}b`)).toBe(`a${ascii}b`);
  });

  it.each([
    ['NFKC compatibility forms', 'ﬁle Ｔｅｓｔ ①', 'file Test 1'],
    ['a decomposed letter is composed', 'Café', 'Café'],
    ['non-breaking and other Unicode spaces', 'a b c　d', 'a b c d'],
    ['runs of whitespace and line breaks', 'a \t\n\r\n  b', 'a b'],
    ['leading and trailing whitespace', '  \n a b \n ', 'a b'],
  ])('%s', (_case, input, expected) => {
    expect(normalizeText(input)).toBe(expected);
  });
});

describe('findQuote spans', () => {
  it('maps a level-1 match back to the original text, across collapsed whitespace', () => {
    const source = 'Intro\n\nLed   the\n“billing”  migration — fast';
    const span = findQuote(source, 'Led the "billing" migration - fast');
    expect(span).not.toBeNull();
    expect(source.slice(...span!)).toBe('Led   the\n“billing”  migration — fast');
  });

  it('maps a level-1 match back through an NFKC expansion', () => {
    const source = 'Wrote the ﬁle parser';
    expect(source.slice(...findQuote(source, 'file parser')!)).toBe('ﬁle parser');
  });

  it('maps a level-2 match back to the first and last letter or digit', () => {
    const source = 'Stack: (Node.js), C++ and C#.';
    const node = findQuote(source, 'nodejs')!;
    expect(source.slice(...node)).toBe('Node.js');
    expect(source.slice(...findQuote(source, 'C++ and C#')!)).toBe('C++ and C#');
  });

  it('takes the first occurrence whose boundaries hold', () => {
    const source = 'JavaScript, then Java';
    expect(findQuote(source, 'Java')).toEqual([17, 21]);
  });

  it('does not match a level-2 quote that starts inside a word', () => {
    expect(findQuote('PostgreSQL', 'sql')).toBeNull();
  });

  it.each([
    ['C', 'C++'],
    ['C', 'C#'],
    ['C+', 'C++'],
  ])('does not end %j right before a sign that belongs to the token in %j', (quote, source) => {
    expect(findQuote(source, quote)).toBeNull();
  });

  it('allows a match that ends on punctuation followed by a letter', () => {
    expect(findQuote('Acme Corp,Kyiv', 'Acme Corp,')).toEqual([0, 10]);
  });

  it.each(['', '   ', '\n\t'])('finds nothing for the quote %j', (quote) => {
    expect(findQuote('Senior Engineer — Acme', quote)).toBeNull();
  });
});
