import { describe, expect, it, test } from 'vitest';
import type { Expected } from './expected.js';
import { matchPositions, type FoundPosition } from './position-match.js';

const position = (
  overrides: Partial<Expected['positions'][number]>,
): Expected['positions'][number] => ({
  company: 'Acme Corp',
  title: 'Senior Engineer',
  start: '2021-03',
  end: null,
  current: true,
  bullets: 2,
  ...overrides,
});

const found = (overrides: Partial<FoundPosition>): FoundPosition => ({
  id: 'f1',
  company: 'Acme Corp',
  title: 'Senior Engineer',
  start: '2021-03',
  end: null,
  current: true,
  bullets: 2,
  ...overrides,
});

describe('matchPositions', () => {
  it('pairs by title and company whatever the case and punctuation', () => {
    const [match] = matchPositions(
      [position({ company: 'Northwind (Larch Media)' })],
      [found({ company: 'NORTHWIND Larch Media', title: 'SENIOR ENGINEER' })],
    );
    expect(match).toMatchObject({ companyOk: true, titleOk: true, datesOk: true });
  });

  it('pairs a position whose company was cleared, and reports the company as missing', () => {
    const [match] = matchPositions([position({})], [found({ company: '' })]);
    expect(match?.found?.id).toBe('f1');
    expect(match?.companyOk).toBe(false);
  });

  it('pairs each found position once, in source order', () => {
    const matches = matchPositions(
      [
        position({ title: 'Research Intern', company: 'Lab A' }),
        position({ title: 'Research Intern', company: 'Lab B' }),
      ],
      [
        found({ id: 'f1', title: 'Research Intern', company: 'Lab A' }),
        found({ id: 'f2', title: 'Research Intern', company: 'Lab B' }),
      ],
    );
    expect(matches.map((match) => match.found?.id)).toEqual(['f1', 'f2']);
  });

  it('pairs a position without a title by its company', () => {
    const [match] = matchPositions(
      [position({ title: '', company: 'Quillbrook Systems Ltd.' })],
      [found({ title: '', company: 'Quillbrook Systems Ltd.' })],
    );
    expect(match).toMatchObject({ companyOk: true, titleOk: true });
  });

  test.each([
    ['another start month', found({ start: '2021-04' }), false],
    ['not current', found({ current: false, end: '2023' }), false],
    ['the same dates', found({}), true],
  ])('dates: %s', (_name, candidate, ok) => {
    expect(matchPositions([position({})], [candidate])[0]?.datesOk).toBe(ok);
  });
});
