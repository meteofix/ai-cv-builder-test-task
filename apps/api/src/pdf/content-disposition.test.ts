import { describe, expect, it } from 'vitest';
import { attachmentHeader } from './content-disposition.js';

describe('attachmentHeader', () => {
  it.each([
    [
      'Iryna Kovalenko',
      'filename="Iryna Kovalenko CV.pdf"',
      "filename*=UTF-8''Iryna%20Kovalenko%20CV.pdf",
    ],
    ['', 'filename="CV.pdf"', "filename*=UTF-8''CV.pdf"],
    ['   ', 'filename="CV.pdf"', "filename*=UTF-8''CV.pdf"],
    [
      'Олег Савчук',
      'filename="CV.pdf"',
      "filename*=UTF-8''%D0%9E%D0%BB%D0%B5%D0%B3%20%D0%A1%D0%B0%D0%B2%D1%87%D1%83%D0%BA%20CV.pdf",
    ],
    ['Zoë Smith', 'filename="Zo Smith CV.pdf"', "filename*=UTF-8''Zo%C3%AB%20Smith%20CV.pdf"],
    [
      'A "quoted"; name/with\\slashes',
      'filename="A quoted name with slashes CV.pdf"',
      "filename*=UTF-8''A%20quoted%20name%20with%20slashes%20CV.pdf",
    ],
    [
      "O'Brien (Jr.)*",
      'filename="O\'Brien (Jr.)* CV.pdf"',
      "filename*=UTF-8''O%27Brien%20%28Jr.%29%2A%20CV.pdf",
    ],
    [
      '100% Ukrainian',
      'filename="100 Ukrainian CV.pdf"',
      "filename*=UTF-8''100%20Ukrainian%20CV.pdf",
    ],
    ['evil\u202Etxt', 'filename="evil txt CV.pdf"', "filename*=UTF-8''evil%20txt%20CV.pdf"],
    [
      'broken \ud800 pair',
      'filename="broken pair CV.pdf"',
      "filename*=UTF-8''broken%20%EF%BF%BD%20pair%20CV.pdf",
    ],
    ['Line\r\nBreak', 'filename="Line Break CV.pdf"', "filename*=UTF-8''Line%20Break%20CV.pdf"],
  ])('%j', (fullName, ascii, encoded) => {
    expect(attachmentHeader(fullName)).toBe(`attachment; ${ascii}; ${encoded}`);
  });
});
