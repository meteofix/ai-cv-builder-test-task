import type { AuthorOutput } from '../../src/generation/compose/author-schema.js';

/** An invented CV for the unit tests of the compose steps; every name in it is made up. */
export const SOURCE = [
  'Olena Hrytsenko', // S1
  'olena.h@example.com · +38 000 123 45 67 · Lviv', // S2
  'github.com/olena-h', // S3
  'EXPERIENCE', // S4
  'Pinecrest Analytics — Senior Backend Engineer, 2021 – present', // S5
  '• Cut report generation from 40 to 6 minutes by moving jobs to a queue', // S6
  '• Mentored two junior developers', // S7
  'Pinecrest Analytics — Backend Engineer, 2019 – 2021', // S8
  '• I was the person who kept our PostgreSQL fast and answered everyone’s', // S9
  'database questions', // S10
  'Grainfield Bakery — Shift Lead, 2015 – 2019', // S11
  '• Ran the morning shift of five people', // S12
  'SKILLS', // S13
  'Go, PostgreSQL (tuning, replication), Kafka', // S14
  'Hobbies: sourdough', // S15
].join('\n');

const item = (text: string | null, ...segments: string[]) => ({ text, segments });

/** A complete author answer for `SOURCE`; tests change the part they are about. */
export function authorAnswer(overrides: Partial<AuthorOutput> = {}): AuthorOutput {
  return {
    locale: 'en',
    contacts: [
      { field: 'fullName', value: 'Olena Hrytsenko', segment: 'S1' },
      { field: 'email', value: 'olena.h@example.com', segment: 'S2' },
      { field: 'phone', value: '+380001234567', segment: 'S2' },
      { field: 'location', value: 'Lviv', segment: 'S2' },
      { field: 'link', value: 'github.com/olena-h', segment: 'S3' },
    ],
    headline: item('Senior Backend Engineer'),
    summary: [item('Backend engineer who speeds up data pipelines.', 'S5', 'S6')],
    experience: [
      {
        title: 'Senior Backend Engineer',
        company: 'Pinecrest Analytics',
        location: '',
        start: '2021',
        end: null,
        current: true,
        segments: ['S5'],
        bullets: [item(null, 'S6'), item(null, 'S7')],
      },
      {
        title: 'Backend Engineer',
        company: 'Pinecrest Analytics',
        location: '',
        start: '2019',
        end: '2021',
        current: false,
        segments: ['S8'],
        bullets: [
          item('Kept PostgreSQL fast; the team’s go-to person for database questions', 'S9', 'S10'),
        ],
      },
      {
        title: 'Shift Lead',
        company: 'Grainfield Bakery',
        location: '',
        start: '2015',
        end: '2019',
        current: false,
        segments: ['S11'],
        bullets: [],
      },
    ],
    education: [],
    skills: [{ title: '', segments: ['S14'], items: [] }],
    additional: [],
    notIncluded: [
      { segments: ['S12'], section: 'experience', job: 3, reason: 'Another profession' },
    ],
    headings: ['S4', 'S13'],
    gaps: [],
    orderReason: '',
    ...overrides,
  };
}
