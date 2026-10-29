import { describe, expect, it } from 'vitest';
import { expectedBullets, parseExpected } from './expected.js';

describe('parseExpected', () => {
  it('reads the json block of a markdown file and counts shared bullets once', () => {
    const expected = parseExpected(
      [
        '# Notes',
        '```json',
        JSON.stringify({
          positions: [
            {
              company: 'Acme Corp',
              title: 'Engineer',
              start: '2021',
              end: null,
              current: true,
              bullets: 1,
              group: 'A',
            },
          ],
          groupBullets: { A: 4 },
          skills: 3,
          contacts: ['fullName'],
          education: 1,
          other: 0,
        }),
        '```',
      ].join('\n'),
    );
    expect(expected).not.toBeNull();
    expect(expectedBullets(expected!)).toBe(5);
  });

  it('expects nothing from a file without a json block', () => {
    expect(parseExpected('# Notes only')).toBeNull();
  });

  it('stops on a json block that does not fit the schema', () => {
    expect(() => parseExpected('```json\n{"positions": 3}\n```')).toThrow();
  });
});
