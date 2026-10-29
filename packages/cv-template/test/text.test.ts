import { describe, expect, it } from 'vitest';
import { LABELS } from '../src/labels.js';
import { dateRange } from '../src/text.js';

describe('dateRange', () => {
  it.each([
    ['both sides', '2021-03', '2022-05', false, 'Mar 2021 – May 2022'],
    ['a start and "Present"', '2023-03', null, true, 'Mar 2023 – Present'],
    ['one known side', '2021', null, false, '2021'],
    ['only "Present"', null, null, true, 'Present'],
    ['nothing known', null, null, false, ''],
    ['the same month at both ends', '2025-11', '2025-11', false, 'Nov 2025'],
    ['the same year at both ends', '2021', '2021', false, '2021'],
    ['a year and one of its months', '2021', '2021-06', false, '2021 – Jun 2021'],
  ])('%s', (_case, start, end, current, expected) => {
    expect(dateRange(start, end, current, LABELS.en)).toBe(expected);
  });
});
