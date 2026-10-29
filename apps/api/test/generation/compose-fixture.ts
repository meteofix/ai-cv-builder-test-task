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

/** An author item; `""` keeps the cited segments word for word. */
const item = (text: string, ...segments: string[]) => ({ text, segments });

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
        end: '',
        current: true,
        segments: ['S5'],
        groups: [{ title: '', items: [item('', 'S6'), item('', 'S7')] }],
      },
      {
        title: 'Backend Engineer',
        company: 'Pinecrest Analytics',
        location: '',
        start: '2019',
        end: '2021',
        current: false,
        segments: ['S8'],
        groups: [
          {
            title: '',
            items: [
              item(
                'Kept PostgreSQL fast; the team’s go-to person for database questions',
                'S9',
                'S10',
              ),
            ],
          },
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
        groups: [],
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
    structureNotes: '',
    ...overrides,
  };
}

/** `SOURCE` with a projects section: S16 its heading, S17 the project line, S18 its bullet. */
export const SOURCE_WITH_PROJECTS = [
  SOURCE,
  'PROJECTS',
  'Proofing Timer, 2022 – 2023',
  '• Reminds a baker when to feed the starter',
].join('\n');

/**
 * `authorAnswer` for `SOURCE_WITH_PROJECTS` with groups: the first job's bullets in a titled group and a
 * plain one, and one project entry with a titled group of one line.
 */
export function groupedAnswer(overrides: Partial<AuthorOutput> = {}): AuthorOutput {
  const [first, ...rest] = authorAnswer().experience;
  return authorAnswer({
    experience: [
      {
        ...first!,
        groups: [
          { title: 'Delivery:', items: [item('', 'S6')] },
          { title: '', items: [item('', 'S7')] },
        ],
      },
      ...rest,
    ],
    additional: [
      {
        title: 'Projects',
        entries: [
          {
            title: 'Proofing Timer',
            start: '2022',
            end: '2023',
            segments: ['S17'],
            groups: [{ title: 'What it does', items: [item('', 'S18')] }],
          },
        ],
      },
    ],
    headings: ['S4', 'S13', 'S16'],
    ...overrides,
  });
}
