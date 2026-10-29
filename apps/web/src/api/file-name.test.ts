import { describe, expect, it } from 'vitest';
import { fileNameOf } from './file-name';

describe('fileNameOf', () => {
  it.each([
    [
      'the UTF-8 name before the ASCII fallback',
      `attachment; filename="CV.pdf"; filename*=UTF-8''%D0%9E%D0%BB%D0%B5%D0%BD%D0%B0%20CV.pdf`,
      'Олена CV.pdf',
    ],
    ['only the ASCII name', 'attachment; filename="Daniel Okafor CV.pdf"', 'Daniel Okafor CV.pdf'],
    [
      'a malformed escape falls back to ASCII',
      `attachment; filename="CV.pdf"; filename*=UTF-8''%E0%A4%A`,
      'CV.pdf',
    ],
    ['no header at all', '', 'cv.pdf'],
  ])('%s', (_case, header, expected) => {
    expect(fileNameOf(header, 'cv.pdf')).toBe(expected);
  });
});
