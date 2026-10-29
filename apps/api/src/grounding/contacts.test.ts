import { describe, expect, it } from 'vitest';
import { checkEmail, checkLink, checkPhone } from './contacts.js';

const SOURCE =
  'Olena Hrytsenko\nOlena.H@Example.com · +38 (000) 123-45-67\nlinkedin.com/in/olena-h\nhttps://github.com/olena-h/';

describe('contacts are checked against the source', () => {
  it.each([
    ['olena.h@example.com', 'olena.h@example.com'],
    ['Olena.H@Example.com', 'Olena.H@Example.com'],
    ['olena@example.com', null],
    ['not an email', null],
  ])('email %j → %j', (value, expected) => {
    expect(checkEmail(value, SOURCE)).toBe(expected);
  });

  it.each([
    ['+380001234567', '+38 (000) 123-45-67'],
    ['+38 000 123 45 67', '+38 (000) 123-45-67'],
    ['+38 000 123 45 68', null],
    ['12345', null],
  ])('phone %j → %j (compared by digits, returned as the source writes it)', (value, expected) => {
    expect(checkPhone(value, SOURCE)).toBe(expected);
  });

  it.each([
    ['linkedin.com/in/ olena-h-123', 'https://linkedin.com/in/olena-h-123'],
    ['https://linkedin.com/in/olena-h-123', 'https://linkedin.com/in/olena-h-123'],
  ])('a link the PDF broke over two lines passes and is joined: %j → %j', (value, expected) => {
    expect(checkLink(value, 'Olena\nlinkedin.com/in/\nolena-h-123\nKyiv')).toBe(expected);
  });

  it('an email the PDF broke over two lines passes and is joined', () => {
    expect(checkEmail('olena.hrytsenko@ example.com', 'olena.hrytsenko@\nexample.com')).toBe(
      'olena.hrytsenko@example.com',
    );
  });

  it.each([
    ['email', () => checkEmail('doe@example.com', 'john.doe@example.com')],
    ['email', () => checkEmail('john@example.co', 'john@example.co.uk')],
    ['link', () => checkLink('linkedin.com/in/ann', 'linkedin.com/in/ann-lee-77')],
    ['link', () => checkLink('github.com/ann', 'https://github.com/ann/dotfiles')],
    ['phone', () => checkPhone('1234567', '+38 (000) 1234567')],
  ])('refuses a %s that is only part of a longer one', (_kind, check) => {
    expect(check()).toBeNull();
  });

  it.each([
    [
      'a line of digits below',
      '+380501234567',
      'Olena · +38 050 123 45 67\n2019 – 2021 Pinecrest',
      '+38 050 123 45 67',
    ],
    ['a line ending in a digit above', '0501234567', 'Lviv 79000\n050 123 45 67', '050 123 45 67'],
  ])('accepts a phone with %s, as the source writes it', (_case, value, source, expected) => {
    expect(checkPhone(value, source)).toBe(expected);
  });

  it.each([
    ['the tail of a longer host', () => checkLink('github.com/ann', 'gist.github.com/ann')],
    ["an email's domain", () => checkLink('example.com', 'ann@example.com')],
  ])('refuses as a link %s', (_case, check) => {
    expect(check()).toBeNull();
  });

  it('accepts a link written with www. or a scheme in the source', () => {
    expect(checkLink('linkedin.com/in/ann', 'https://www.linkedin.com/in/ann/')).toBe(
      'https://linkedin.com/in/ann',
    );
  });

  it('accepts a phone the PDF wrapped onto the next line, and joins no lines further apart', () => {
    expect(checkPhone('+00 44 555 0193', 'Olena · +00 44 555\n0193 · Lviv')).toBe(
      '+00 44 555 0193',
    );
    expect(checkPhone('2019 2021 555', '2019\n2021\n555')).toBeNull();
  });

  it.each([
    ['linkedin.com/in/olena-h', 'https://linkedin.com/in/olena-h'],
    ['https://www.linkedin.com/in/olena-h/', 'https://www.linkedin.com/in/olena-h/'],
    ['https://GitHub.com/olena-h', 'https://GitHub.com/olena-h'],
    ['https://github.com/someone-else', null],
    ['javascript:alert(1)', null],
    ['ftp://github.com/olena-h', null],
  ])('link %j → %j', (value, expected) => {
    expect(checkLink(value, SOURCE)).toBe(expected);
  });
});
