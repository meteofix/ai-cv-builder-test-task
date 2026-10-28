import { describe, expect, it } from 'vitest';
import type { Fact } from './facts.js';
import { checkNumbers, numberTokens, selectSkills } from './prose.js';

describe('numberTokens', () => {
  it.each([
    ['38%', ['38%'], []],
    ['+40%', ['+40%'], []],
    ['38 %', ['38%'], []],
    ['3x and 4×', ['3x', '4×'], []],
    ['$2M, €1.5k, 200₴', ['$2m', '€1.5k', '200₴'], []],
    ['10k+ users', ['10k+'], []],
    ['5+ years', ['5+'], []],
    ['in 2021, 14 people, 1,000 rows', [], ['2021', '14', '1,000']],
    ['S3, ES6, p95, B2B, IPv6, 2FA, 4Kbps', [], []],
    ['version v1.2.3', [], []],
  ])('%j → metrics %j, standalone %j', (text, metrics, standalone) => {
    expect(numberTokens(text)).toEqual({ metrics, standalone });
  });
});

describe('checkNumbers', () => {
  it('compares metrics case-insensitively and without spaces', () => {
    expect(checkNumbers('Grew to 10K users.', ['Grew to 10 k users'], '').ok).toBe(false);
    expect(checkNumbers('Grew to 10K users.', ['Grew to 10k users'], '').ok).toBe(true);
  });

  it('does not accept a metric that is only elsewhere in the source', () => {
    const source = 'Cut costs by 40%.\nShipped search.';
    expect(
      checkNumbers('Shipped search, cutting costs by 40%.', ['Shipped search.'], source),
    ).toEqual({
      ok: false,
      unsupported: ['40%'],
    });
  });

  it.each([
    ['Led teams for 5 years.', 'Led teams for 5+ years.'],
    ['Managed a 2 million budget.', 'Managed a $2M budget.'],
  ])('does not count the number inside a source metric: %j', (text, source) => {
    expect(checkNumbers(text, [], source)).toEqual({
      ok: false,
      unsupported: [expect.any(String)],
    });
  });

  it('does not check the tail of a dotted version', () => {
    expect(checkNumbers('Upgraded to v1.2.3.', ['Upgraded the SDK.'], 'Upgraded the SDK.').ok).toBe(
      true,
    );
  });

  it('does not accept a standalone number that is only part of a longer number', () => {
    expect(checkNumbers('Led 14 engineers.', ['Led engineers.'], 'Led 140 engineers.').ok).toBe(
      false,
    );
  });
});

describe('selectSkills', () => {
  it('keeps kept skill ids in the writer order, once each', () => {
    const facts: Fact[] = [
      { id: 'f1', kind: 'skill', quote: 'Go', span: [0, 2], skill: { name: 'Go' } },
      { id: 'f2', kind: 'profile', quote: 'Calm', span: [3, 7] },
      { id: 'f3', kind: 'skill', quote: 'SQL', span: [8, 11], skill: { name: 'SQL' } },
    ];
    expect(selectSkills(['f3', 'f9', 'f2', 'f1', 'f3'], facts)).toEqual(['f3', 'f1']);
  });
});
