import { describe, expect, it } from 'vitest';
import { assertNoNul } from './no-nul.js';

describe('assertNoNul', () => {
  it.each([
    ['a string', 'a\u0000b'],
    ['an array element', ['fine', 'a\u0000b']],
    ['a nested object', { experience: [{ bullets: [{ text: 'a\u0000b' }] }] }],
    ['an object key', { 'a\u0000b': 'fine' }],
  ])('refuses a NUL in %s', (_case, value) => {
    expect(() => {
      assertNoNul(value, 'field');
    }).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }) as Error);
  });

  it.each([
    ['the six characters backslash-u-0-0-0-0', String.raw`Escapes such as \u0000 are text`],
    ['an empty string', ''],
    ['numbers, booleans and null', { count: 0, done: false, nothing: null }],
    ['an empty array', []],
  ])('lets %s through', (_case, value) => {
    expect(() => {
      assertNoNul(value, 'field');
    }).not.toThrow();
  });
});
