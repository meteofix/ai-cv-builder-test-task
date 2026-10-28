import { describe, expect, it } from 'vitest';
import { assertFontsLoaded } from './font-check.js';

describe('assertFontsLoaded', () => {
  it('accepts six declared faces that are all loaded', () => {
    expect(() => {
      assertFontsLoaded({ declared: 6, loaded: 6 });
    }).not.toThrow();
  });

  it.each([
    ['a face that failed to load', { declared: 6, loaded: 5 }],
    ['no face of the family declared at all', { declared: 0, loaded: 0 }],
    ['a missing face', { declared: 5, loaded: 5 }],
    ['an extra face', { declared: 7, loaded: 7 }],
  ])('refuses %s', (_case, result) => {
    expect(() => {
      assertFontsLoaded(result);
    }).toThrow(/IBM Plex Sans/);
  });
});
