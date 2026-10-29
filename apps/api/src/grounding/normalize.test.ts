import { describe, expect, it } from 'vitest';
import { normalizeText } from './normalize.js';

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
