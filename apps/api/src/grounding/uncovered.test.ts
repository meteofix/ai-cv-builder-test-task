import { describe, expect, it } from 'vitest';
import { contentLines } from './uncovered.js';

describe('contentLines', () => {
  it('keeps lines with a letter once, without section headings', () => {
    expect(
      contentLines('Experience\nAcme\n----\nAcme\n2021\nBuilt things', ['Experience']),
    ).toEqual(['Acme', 'Built things']);
  });
});
