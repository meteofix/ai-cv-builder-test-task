import type { AuthorOutput } from '../../src/generation/compose/author-schema.js';
import type { ReviewOutput } from '../../src/generation/compose/review.js';

/**
 * "The sample author answer" of docs/specs/generation.md: it cites the segments of `SAMPLE_SOURCE_TEXT`
 * correctly — S1 name, S2 email and city, S3/S6/S8 headings, S4 the Acme line, S5 its bullet, S7 the
 * education line, S9 the skills line.
 */
export function sampleAuthorAnswer(overrides: Partial<AuthorOutput> = {}): AuthorOutput {
  return {
    locale: 'en',
    contacts: [
      { field: 'fullName', value: 'Iryna Kovalenko', segment: 'S1' },
      { field: 'email', value: 'iryna@example.com', segment: 'S2' },
      { field: 'location', value: 'Kyiv', segment: 'S2' },
    ],
    headline: { text: '', segments: [] },
    summary: [
      {
        text: 'Senior engineer who moved a billing service to TypeScript.',
        segments: ['S4', 'S5'],
      },
    ],
    experience: [
      {
        title: 'Senior Engineer',
        company: 'Acme Corp',
        location: '',
        start: '2021',
        end: null,
        current: true,
        segments: ['S4'],
        bullets: [{ text: null, segments: ['S5'] }],
      },
    ],
    education: [
      {
        institution: 'Kyiv Polytechnic Institute',
        degree: 'BSc Computer Science',
        start: '2014',
        end: '2018',
        segments: ['S7'],
      },
    ],
    skills: [{ title: '', segments: ['S9'], items: [] }],
    additional: [],
    notIncluded: [],
    headings: ['S3', 'S6', 'S8'],
    gaps: [],
    orderReason: '',
    ...overrides,
  };
}

export const NO_ISSUES: ReviewOutput = { issues: [] };

export function reviewIssue(issue: Partial<ReviewOutput['issues'][number]> & { item: string }) {
  return {
    action: 'fix' as const,
    class: 'other' as const,
    text: null,
    segments: [],
    question: null,
    ...issue,
  };
}
