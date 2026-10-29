import type { CvDocument } from '@cv/shared';

const bullets = (prefix: string, texts: string[]) =>
  texts.map((text, index) => ({ id: `${prefix}-${index + 1}`, text, factIds: [] }));

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
      bullets: bullets('p1b', [
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
      bullets: bullets('p2b', [
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
      bullets: bullets('p3b', [
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
      bullets: bullets('p4b', [
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
      bullets: bullets('p5b', ['Wrote and maintained manual test cases for a mobile banking app.']),
    },
    {
      id: 'p6',
      company: 'Example Labs',
      title: 'QA Intern',
      start: '2018-07',
      end: '2018-09',
      current: false,
      bullets: [],
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
    'TypeScript',
    'JavaScript',
    'React',
    'Next.js',
    'Node.js',
    'NestJS',
    'PostgreSQL',
    'Redis',
    'Docker',
    'Playwright',
    'Vitest',
    'AWS',
    'GitHub Actions',
    'Figma',
  ].map((name, index) => ({ id: `s${index}`, name })),
  additional: [
    {
      id: 'a1',
      title: 'Certifications',
      items: bullets('a1i', [
        'AWS Certified Developer – Associate, 2022',
        'Professional Scrum Master I, 2021',
      ]),
    },
    {
      id: 'a2',
      title: 'Languages',
      items: bullets('a2i', ['Ukrainian — native', 'English — C1', 'Polish — B1']),
    },
    {
      id: 'a3',
      title: 'Volunteering',
      items: bullets('a3i', [
        'Mentor at a free community bootcamp for career switchers, 2020–2022',
      ]),
    },
  ],
};
