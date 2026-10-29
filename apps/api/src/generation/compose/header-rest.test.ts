import { describe, expect, it, test } from 'vitest';
import { authorAnswer, SOURCE } from '../../../test/generation/compose-fixture.js';
import { compose, prepareSource } from './compose.js';
import type { DraftJob } from './draft.js';
import { COMPANY_DESCRIPTION, headerRests } from './header-rest.js';

const job = (fields: Partial<DraftJob>): DraftJob => ({
  title: 'Motion Designer',
  company: 'Quillbeam Studio',
  location: '',
  start: '2023-03',
  end: null,
  current: true,
  segments: ['S1', 'S2'],
  groups: [],
  ...fields,
});

/** The rests of a header whose lines are `title` (S1) and `dates` (S2). */
function rests(dates: string, fields: Partial<DraftJob> = {}, elsewhere: string[] = []) {
  const { index } = prepareSource(`Quillbeam Studio — Motion Designer\n${dates}`);
  return headerRests([job(fields)], new Set(elsewhere), index).map((item) => item.text);
}

describe('headerRests — what a job header cites but does not show', () => {
  test.each([
    [
      'a dates line with a company description',
      'Mar 2023 – present | Mobile games publisher, 40M installs',
      ['Mobile games publisher, 40M installs'],
    ],
    ['a dates line alone', 'Mar 2023 – present', []],
    ['dates written letter-spaced', 'M a r c h 2 0 2 3 -', []],
    [
      'a promotion in brackets next to the dates',
      'Mar 2023 – present (promoted) · Mobile games',
      ['promoted · Mobile games'],
    ],
    ['a part that repeats a word of the title', 'Mar 2023 – present | Senior motion work', []],
    ['a part without a letter', 'Mar 2023 – present | 40+', []],
    // Known limit: counts alone read as a duration whatever their unit.
    ['a field of counts alone', 'Mar 2023 – present | 300 clients', []],
    ['a duration next to the dates', 'Mar 2023 – present (2 years 11 months)', []],
    ['a work mode next to a duration', 'Full-time · Remote · 5 yrs 4 mos', ['Full-time · Remote']],
  ])('%s', (_, dates, expected) => {
    expect(rests(dates)).toEqual(expected);
  });

  it('does not take a short word ("of") shared with the title for the field shown', () => {
    expect(rests('Mar 2023 – present | Art of games', { title: 'Head of Motion' })).toEqual([
      'Art of games',
    ]);
  });

  it('leaves a line alone that something else in the CV cites', () => {
    expect(rests('Mar 2023 – present | Mobile games publisher', {}, ['S2'])).toEqual([]);
  });

  it('reads a line two positions share with the fields of both, and lists it under the first', () => {
    const { index } = prepareSource(
      'Quillbeam Studio | Mobile games publisher\nMar 2023 – present',
    );
    const jobs = [
      job({ segments: ['S1', 'S2'] }),
      job({
        title: 'Designer',
        start: '2020-01',
        end: '2023-02',
        current: false,
        segments: ['S1'],
      }),
    ];
    expect(headerRests(jobs, new Set(), index)).toEqual([
      {
        text: 'Mobile games publisher',
        reason: 'not_included',
        context: COMPANY_DESCRIPTION,
        section: 'experience',
        itemId: 'p1',
      },
    ]);
  });
});

describe('"Not in your CV" shows the rest of a job header', () => {
  it('lists a company description on the dates line, with its reason and job', () => {
    const source = SOURCE.replace(
      'Pinecrest Analytics — Backend Engineer, 2019 – 2021',
      'Pinecrest Analytics — Backend Engineer, 2019 – 2021 | Freight software, 300 clients',
    );
    const { analysis } = compose(prepareSource(source), authorAnswer(), { issues: [] }, 'Engineer');
    expect(analysis.notInCv).toContainEqual({
      text: 'Freight software, 300 clients',
      reason: 'not_included',
      context: COMPANY_DESCRIPTION,
      section: 'experience',
      itemId: 'p2',
    });
  });

  const described = SOURCE.replace(
    'Pinecrest Analytics — Backend Engineer, 2019 – 2021',
    'Pinecrest Analytics — Backend Engineer, 2019 – 2021 | Freight software, 300 clients',
  );
  const restsOf = (answer: ReturnType<typeof authorAnswer>) =>
    compose(prepareSource(described), answer, { issues: [] }, 'Engineer')
      .analysis.notInCv.filter((item) => item.context === COMPANY_DESCRIPTION)
      .map((item) => item.text);

  it('lists the rest of a header line the author also left out, which the CV shows nowhere else', () => {
    const answer = authorAnswer();
    answer.notIncluded.push({ segments: ['S8'], section: 'experience', job: 2, reason: 'Old job' });
    expect(restsOf(answer)).toEqual(['Freight software, 300 clients']);
  });

  it('lists nothing for a header line a bullet cites too', () => {
    const answer = authorAnswer();
    const [, second] = answer.experience;
    second!.groups[0]!.items.push({ text: 'Freight software for 300 clients', segments: ['S8'] });
    expect(restsOf(answer)).toEqual([]);
  });

  it('lists nothing for header lines that hold only what the CV shows', () => {
    const { analysis } = compose(prepareSource(SOURCE), authorAnswer(), { issues: [] }, 'Engineer');
    expect(analysis.notInCv.filter((item) => item.context === COMPANY_DESCRIPTION)).toEqual([]);
  });
});
