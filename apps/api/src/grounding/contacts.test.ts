import { describe, expect, it } from 'vitest';
import { checkEmail, checkLink, checkPhone, telegramLink } from './contacts.js';

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
    // A stylized handle in a CV header: `https://` in front would make it look like a link.
    ['a handle with a scheme of its own', () => checkLink('Github://ann', 'Github://ann')],
    // Parsed as a URL these are a user before a host without a dot.
    ['a handle after a label and @', () => checkLink('Signal@ann_k', 'Signal@ann_k')],
    ['a handle after a label, a colon and @', () => checkLink('Signal:@ann_k', 'Signal: @ann_k')],
    ['an address whose host has no dot', () => checkLink('intranet/ann', 'intranet/ann')],
  ])('refuses as a link %s', (_case, check) => {
    expect(check()).toBeNull();
  });

  it('keeps the letters of a link as the source writes them: a path can be case-sensitive', () => {
    expect(checkLink('https://portfolio.example/cv', 'See https://portfolio.example/CV')).toBe(
      'https://portfolio.example/CV',
    );
  });

  it('rebuilds a link whose host begins with what www. leaves', () => {
    expect(checkLink('www.ww.example/x', 'see www.ww.example/x')).toBe('https://www.ww.example/x');
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
    // The source's letters, not the author's: "github.com" as the source writes it.
    ['https://GitHub.com/olena-h', 'https://github.com/olena-h'],
    ['https://github.com/someone-else', null],
    ['javascript:alert(1)', null],
    ['ftp://github.com/olena-h', null],
  ])('link %j → %j', (value, expected) => {
    expect(checkLink(value, SOURCE)).toBe(expected);
  });

  it.each([
    ['Telegram @ann_k77', 'https://t.me/ann_k77'],
    ['Telegram: @ann_k77', 'https://t.me/ann_k77'],
    ['TG @ann_k77', 'https://t.me/ann_k77'],
    ['Telegram handle: ann_k77', 'https://t.me/ann_k77'],
    ['telegram — @ann_k77', 'https://t.me/ann_k77'],
  ])('turns a handle labelled as Telegram into its link: %j → %j', (value, expected) => {
    expect(telegramLink(value, `Ann Kovach\n${value} · ann@example.com`)).toBe(expected);
  });

  it.each([
    ['a handle without a service', '@ann_k77'],
    ['a handle of another service', 'Signal: @ann_k77'],
    ['an Instagram handle', 'Instagram @ann_k77'],
    ['a handle too short for Telegram', 'Telegram @ann'],
    // No separator after "tg": a word, not a label.
    ['a word that starts with tg', 'tgannkovach'],
    ['a word after Telegram without a separator', 'Telegram username'],
  ])('leaves %s alone', (_case, value) => {
    expect(telegramLink(value, value)).toBeNull();
  });

  it('labels a Telegram handle in Ukrainian too', () => {
    expect(telegramLink('Телеграм: @ann_k77', 'Телеграм: @ann_k77')).toBe('https://t.me/ann_k77');
  });

  it.each([
    ['another handle', 'Telegram @ann_k78'],
    ['a longer handle that starts with it', 'Telegram @ann_k778'],
  ])('turns no handle into a link when the source has %s', (_case, source) => {
    expect(telegramLink('Telegram @ann_k77', source)).toBeNull();
  });
});
