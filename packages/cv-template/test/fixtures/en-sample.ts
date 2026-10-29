import type { CvDocument } from '@cv/shared';

const bullets = (prefix: string, texts: string[]) =>
  texts.map((text, index) => ({ id: `${prefix}-${index + 1}`, text, factIds: [] }));

/** One group without a title: the plain list the reference shows. */
const plain = (prefix: string, texts: string[]) => [
  { id: `${prefix}-g`, title: null, items: bullets(prefix, texts) },
];

/** An extra section's flat lines, as one entry without a title or dates (the shape migrated CVs have). */
const lines = (prefix: string, texts: string[]) => [
  { id: `${prefix}-e`, title: '', start: null, end: null, groups: plain(prefix, texts) },
];

/** The content of `docs/design/cv-template/resume-a-en.html` as a document, nothing left out. */
export const enSample: CvDocument = {
  locale: 'en',
  contacts: {
    fullName: 'Iryna Kovalenko',
    email: 'iryna.kovalenko@example.com',
    phone: '+1 (555) 010-0142',
    location: 'Kyiv, Ukraine',
    links: [
      'https://linkedin.com/in/iryna-kovalenko-example',
      'https://github.com/ikovalenko-example',
    ],
  },
  headline: 'Senior Full-Stack Engineer',
  summary: {
    text: 'Full-stack engineer with 7 years of experience building B2C and B2B web products in TypeScript, React and Node.js. Led the migration of a subscription checkout to Next.js 14 and built internal tooling for experiment analysis. Comfortable owning features end to end, from database schema to UI.',
    factIds: [],
  },
  experience: [
    {
      id: 'p1',
      company: 'Northwind Learning',
      title: 'Senior Full-Stack Engineer',
      location: 'Kyiv, Ukraine',
      start: '2023-03',
      end: null,
      current: true,
      groups: plain('p1b', [
        'Led the migration of the web checkout from Next.js 12 to Next.js 14, reducing the JavaScript bundle size by 38%.',
        'Designed a PostgreSQL-backed job queue for report generation, replacing a cron script that silently dropped jobs under load and required manual restarts several times a week, which had been a recurring source of support tickets from enterprise customers.',
        'Built an internal A/B test dashboard used by 4 product teams to review experiment results without analyst support.',
        'Mentored 3 engineers through code reviews and pairing sessions.',
      ]),
    },
    {
      id: 'p2',
      company: 'Brightpath Studio',
      title: 'Full-Stack Engineer',
      location: 'Remote',
      start: '2021-01',
      end: '2023-02',
      current: false,
      groups: plain('p2b', [
        'Developed REST APIs in NestJS for a B2B scheduling product with 120 enterprise customers.',
        'Introduced end-to-end tests with Playwright, halving the number of regressions found in production over two quarters.',
        'Implemented CSV import with row-level validation errors shown in the UI.',
      ]),
    },
    {
      id: 'p3',
      company: 'Lumen Media',
      title: 'Frontend Developer',
      location: 'Kyiv, Ukraine',
      start: '2019-06',
      end: '2020-12',
      current: false,
      groups: plain('p3b', [
        'Built responsive landing pages and quiz funnels in React for marketing campaigns in 6 markets.',
        'Integrated product analytics events and maintained the tracking plan.',
      ]),
    },
    {
      id: 'p4',
      company: 'Freelance',
      title: 'Web Developer',
      start: null,
      end: null,
      current: false,
      groups: plain('p4b', [
        'Delivered small business websites for local clients using WordPress and custom JavaScript.',
      ]),
    },
    // Two positions at one company: the shared bullets sit on the first (behaviour 5a).
    {
      id: 'p5',
      company: 'Example Labs',
      title: 'QA Engineer',
      start: '2018-10',
      end: '2019-05',
      current: false,
      groups: plain('p5b', ['Wrote and maintained manual test cases for a mobile banking app.']),
    },
    {
      id: 'p6',
      company: 'Example Labs',
      title: 'QA Intern',
      start: '2018-07',
      end: '2018-09',
      current: false,
      groups: [],
    },
  ],
  education: [
    {
      id: 'e1',
      institution: 'State University of Technology',
      degree: 'MSc in Computer Science',
      start: '2017',
      end: '2019',
    },
    {
      id: 'e2',
      institution: 'State University of Technology',
      degree: 'BSc in Applied Mathematics',
      start: '2013',
      end: '2017',
    },
  ],
  skills: [
    ['Languages', ['TypeScript', 'JavaScript']],
    ['Frontend', ['React', 'Next.js']],
    ['Backend', ['Node.js', 'NestJS', 'PostgreSQL', 'Redis']],
    ['Tooling', ['Docker', 'Playwright', 'Vitest', 'AWS', 'GitHub Actions', 'Figma']],
  ].map(([title, names], group) => ({
    id: `g${group}`,
    title: title as string,
    items: (names as string[]).map((name, index) => ({ id: `s${group}-${index}`, name })),
  })),
  additional: [
    {
      id: 'a1',
      title: 'Certifications',
      entries: lines('a1i', [
        'AWS Certified Developer – Associate, 2022',
        'Professional Scrum Master I, 2021',
      ]),
    },
    {
      id: 'a2',
      title: 'Languages',
      entries: lines('a2i', ['Ukrainian — native', 'English — C1', 'Polish — B1']),
    },
    {
      id: 'a3',
      title: 'Volunteering',
      entries: lines('a3i', [
        'Mentor at a free community bootcamp for career switchers, 2020–2022',
      ]),
    },
  ],
};
