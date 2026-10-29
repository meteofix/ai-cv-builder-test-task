import { describe, expect, it } from 'vitest';
import { contentLines, uncoveredLines } from './uncovered.js';

describe('contentLines', () => {
  it('keeps lines with a letter once, without section headings', () => {
    expect(
      contentLines('Experience\nAcme\n----\nAcme\n2021\nBuilt things', ['Experience']),
    ).toEqual(['Acme', 'Built things']);
  });

  it('is what uncoveredLines counts from', () => {
    const source = 'Experience\nAcme\nBuilt things';
    expect(uncoveredLines(source, [[11, 15]], ['Experience'])).toEqual(['Built things']);
  });
});
