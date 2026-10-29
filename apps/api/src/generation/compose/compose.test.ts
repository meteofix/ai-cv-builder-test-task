import { bulletsOf, cvDocumentSchema } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import { authorAnswer, SOURCE } from '../../../test/generation/compose-fixture.js';
import { authorRequest, compose, prepareSource, reviewRequest } from './compose.js';
import type { ReviewOutput } from './review.js';

const ROLE = 'Senior Backend Engineer';
const NOW = new Date('2026-10-29T12:00:00Z');
const NO_ISSUES: ReviewOutput = { issues: [] };
const source = prepareSource(SOURCE);

describe('compose — kept text and structure', () => {
  it('fills kept items with the source text, list markers removed and wrapped lines joined', () => {
    const { document } = compose(
      source,
      authorAnswer({
        experience: [
          {
            ...authorAnswer().experience[1]!,
            groups: [{ title: '', items: [{ text: '', segments: ['S9', 'S10'] }] }],
          },
        ],
      }),
      NO_ISSUES,
      ROLE,
    );
    expect(bulletsOf(document.experience[0]!)[0]).toMatchObject({
      text: 'I was the person who kept our PostgreSQL fast and answered everyone’s database questions',
      factIds: ['S9', 'S10'],
    });
  });

  it('gives the bullets of all jobs the ending most of them have, kept ones included', () => {
    const [first, second, third] = authorAnswer().experience;
    const answer = authorAnswer({
      experience: [
        {
          ...first!,
          groups: [
            {
              title: '',
              items: [
                { text: 'Cut report generation from 40 to 6 minutes.', segments: ['S6'] },
                { text: '', segments: ['S7'] },
              ],
            },
          ],
        },
        {
          ...second!,
          groups: [{ title: '', items: [{ text: 'Kept PostgreSQL fast.', segments: ['S9'] }] }],
        },
        {
          ...third!,
          groups: [
            { title: '', items: [{ text: 'Ran a morning shift of five.', segments: ['S12'] }] },
          ],
        },
      ],
    });
    const { document } = compose(source, answer, NO_ISSUES, ROLE);
    expect(document.experience.flatMap((job) => bulletsOf(job).map((b) => b.text))).toEqual([
      'Cut report generation from 40 to 6 minutes.',
      'Mentored two junior developers.',
      'Kept PostgreSQL fast.',
      'Ran a morning shift of five.',
    ]);
  });

  it.each(['• ', '▪ ', '- ', '* ', '– ', '1. '])(
    'removes the list marker %j from a kept line',
    (marker) => {
      const marked = prepareSource(SOURCE.replace('• Mentored', `${marker}Mentored`));
      const { document } = compose(marked, authorAnswer(), NO_ISSUES, ROLE);
      expect(bulletsOf(document.experience[0]!)[1]?.text).toBe('Mentored two junior developers');
    },
  );

  it('keeps a rewritten item as written, citing its evidence', () => {
    const { document } = compose(source, authorAnswer(), NO_ISSUES, ROLE);
    expect(bulletsOf(document.experience[1]!)[0]?.text).toBe(
      'Kept PostgreSQL fast; the team’s go-to person for database questions',
    );
    expect(bulletsOf(document.experience[0]!).map((bullet) => bullet.text)).toEqual([
      'Cut report generation from 40 to 6 minutes by moving jobs to a queue',
      'Mentored two junior developers',
    ]);
  });

  it('cuts a kept skill group into skills without breaking brackets', () => {
    const { document } = compose(source, authorAnswer(), NO_ISSUES, ROLE);
    expect(document.skills.flatMap((group) => group.items.map((skill) => skill.name))).toEqual([
      'Go',
      'PostgreSQL (tuning, replication)',
      'Kafka',
    ]);
  });

  it('keeps skill groups with their titles, in the order the author gives', () => {
    const answer = authorAnswer({
      skills: [
        { title: 'Data', segments: ['S14'], items: ['PostgreSQL', 'Kafka'] },
        { title: '', segments: ['S14'], items: ['Go'] },
      ],
    });
    const { document } = compose(source, answer, NO_ISSUES, ROLE);
    expect(
      document.skills.map((group) => [group.title, group.items.map((skill) => skill.name)]),
    ).toEqual([
      ['Data', ['PostgreSQL', 'Kafka']],
      [null, ['Go']],
    ]);
  });

  it('cuts each kept line of a group on its own, so every line loses its label', () => {
    const labelled = prepareSource(`${SOURCE}\nLanguages: English, Polish\nTools: Git, Docker`);
    const answer = authorAnswer({ skills: [{ title: '', segments: ['S16', 'S17'], items: [] }] });
    const { document } = compose(labelled, answer, NO_ISSUES, ROLE);
    expect(document.skills.flatMap((group) => group.items.map((skill) => skill.name))).toEqual([
      'English',
      'Polish',
      'Git',
      'Docker',
    ]);
  });

  it('produces a document the shared schema accepts, with ids questions can name', () => {
    const { document } = compose(source, authorAnswer(), NO_ISSUES, ROLE);
    expect(cvDocumentSchema.safeParse(document).success).toBe(true);
    expect(document.experience.map((job) => job.id)).toEqual(['p1', 'p2', 'p3']);
    expect(document.experience[0]).toMatchObject({ current: true, end: null, factId: 'S5' });
  });
});

describe('compose — contacts', () => {
  it('keeps an email, phone and link the source contains, the link with a scheme', () => {
    const { contacts } = compose(source, authorAnswer(), NO_ISSUES, ROLE).document;
    expect(contacts).toEqual({
      fullName: 'Olena Hrytsenko',
      email: 'olena.h@example.com',
      phone: '+38 000 123 45 67',
      location: 'Lviv',
      links: ['https://github.com/olena-h'],
    });
  });

  it('drops an email, phone or link that is not in the source', () => {
    const answer = authorAnswer({
      contacts: [
        { field: 'email', value: 'olena@example.org', segment: 'S2' },
        { field: 'phone', value: '+38 000 999 99 99', segment: 'S2' },
        { field: 'link', value: 'https://linkedin.com/in/olena', segment: 'S3' },
      ],
    });
    const { contacts } = compose(source, answer, NO_ISSUES, ROLE).document;
    expect(contacts).toMatchObject({ email: '', phone: '', links: [] });
  });
});

describe('compose — the review', () => {
  it('a fix replaces the item and its evidence', () => {
    const review: ReviewOutput = {
      issues: [
        {
          item: 'job.2.1',
          action: 'fix',
          class: 'inflated_scope',
          text: 'Kept PostgreSQL fast and answered database questions',
          segments: ['S9', 'S10'],
          question: null,
        },
      ],
    };
    const { document, questions } = compose(source, authorAnswer(), review, ROLE);
    expect(bulletsOf(document.experience[1]!)[0]?.text).toBe(
      'Kept PostgreSQL fast and answered database questions',
    );
    expect(questions).toEqual([]);
  });

  it('an ask on a skill group puts it into "Not in your CV" instead of asking: no answer could apply', () => {
    const review: ReviewOutput = {
      issues: [
        {
          item: 'skills.1',
          action: 'ask',
          class: 'invented_detail',
          text: null,
          segments: [],
          question: 'Did you use Kafka?',
        },
      ],
    };
    const { document, questions, analysis } = compose(source, authorAnswer(), review, ROLE);
    expect(document.skills).toEqual([]);
    expect(questions.filter((question) => question.target.section === 'skills')).toEqual([]);
    expect(analysis.notInCv).toContainEqual({
      text: 'Go, PostgreSQL (tuning, replication), Kafka',
      reason: 'not_included',
      context: 'Did you use Kafka?',
      section: 'skills',
    });
  });

  it('an ask takes the item out and asks about it with the proposed text', () => {
    const review: ReviewOutput = {
      issues: [
        {
          item: 'job.1.1',
          action: 'ask',
          class: 'wrong_number',
          text: 'Cut report generation from 40 to 6 minutes',
          segments: [],
          question: 'Was it 6 minutes for every report?',
        },
      ],
    };
    const { document, questions } = compose(source, authorAnswer(), review, ROLE);
    expect(bulletsOf(document.experience[0]!).map((bullet) => bullet.text)).toEqual([
      'Mentored two junior developers',
    ]);
    // The answer will rewrite the group the bullet stood in (docs/specs/generation.md §5), at its place.
    expect(questions[0]).toEqual({
      kind: 'unverified',
      target: { section: 'experience', itemId: 'p1-g1', position: 0 },
      prompt: 'Was it 6 minutes for every report?',
      context: 'Cut report generation from 40 to 6 minutes',
      answerType: 'text',
    });
  });

  it.each([
    ['the second bullet', ['job.1.2'], [1]],
    // Each keeps its own index; the answer counts the earlier ones that are not back yet.
    ['both bullets', ['job.1.1', 'job.1.2'], [0, 1]],
  ])('stores where %s stood in its group as the review saw it', (_, items, positions) => {
    const review: ReviewOutput = {
      issues: items.map((item) => ({
        item,
        action: 'ask' as const,
        class: 'wrong_number' as const,
        text: null,
        segments: [],
        question: 'Is this right?',
      })),
    };
    const { questions } = compose(source, authorAnswer(), review, ROLE);
    expect(questions.map((question) => question.target.position)).toEqual(positions);
  });

  it('lists a line read as a heading that the reviewer calls content in "Not in your CV", without a question', () => {
    const review: ReviewOutput = {
      issues: [
        {
          item: 'heading.S15',
          action: 'ask',
          class: 'other',
          text: null,
          segments: [],
          question: 'A hobby of the person, not a heading',
        },
      ],
    };
    const answer = authorAnswer({ headings: ['S4', 'S13', 'S15'] });
    const { questions, analysis } = compose(source, answer, review, ROLE);
    expect(questions).toEqual([]);
    expect(analysis.notInCv).toContainEqual({
      text: 'Hobbies: sourdough',
      reason: 'not_included',
      context: 'A hobby of the person, not a heading',
    });
  });

  it('a fixed date sets the fields; an asked date empties them and becomes a dates question', () => {
    const issue = (action: 'fix' | 'ask', item: string, text: string | null) => ({
      item,
      action,
      class: 'wrong_time' as const,
      text,
      segments: ['S8'],
      question: null,
    });
    const review: ReviewOutput = {
      issues: [issue('fix', 'job.2.dates', '2019-03 – 2021-06'), issue('ask', 'job.3.dates', null)],
    };
    const { document, questions } = compose(source, authorAnswer(), review, ROLE);
    expect(document.experience[1]).toMatchObject({
      start: '2019-03',
      end: '2021-06',
      current: false,
    });
    expect(document.experience[2]).toMatchObject({ start: null, end: null, current: false });
    expect(questions[0]).toMatchObject({
      kind: 'missing',
      target: { section: 'experience', itemId: 'p3', field: 'dates' },
      answerType: 'dates',
      context: '2015 – 2019',
    });
  });

  it('a headline without evidence is the target role, also after a fix', () => {
    const answer = authorAnswer({ headline: { text: 'DevOps / Platform Engineer', segments: [] } });
    expect(compose(source, answer, NO_ISSUES, ROLE).document.headline).toBe(ROLE);
    const review: ReviewOutput = {
      issues: [
        {
          item: 'headline',
          action: 'fix',
          class: 'other',
          text: 'Staff Engineer',
          segments: [],
          question: null,
        },
      ],
    };
    const own = authorAnswer({ headline: { text: '', segments: ['S5'] } });
    expect(compose(source, own, review, ROLE).document.headline).toBe(ROLE);
  });

  it('an asked headline falls back to the target role without a question', () => {
    const review: ReviewOutput = {
      issues: [
        {
          item: 'headline',
          action: 'ask',
          class: 'inflated_scope',
          text: null,
          segments: [],
          question: 'Lead?',
        },
      ],
    };
    const { document, questions } = compose(
      source,
      authorAnswer({ headline: { text: 'Lead Backend Architect', segments: [] } }),
      review,
      ROLE,
    );
    expect(document.headline).toBe(ROLE);
    expect(questions).toEqual([]);
  });

  it("shows the reviewer a company's shared bullets after all its titles, not under the first", () => {
    const [first, second, third] = authorAnswer().experience;
    const answer = authorAnswer({
      experience: [
        { ...first!, groups: [{ title: '', items: [{ text: '', segments: ['S6'] }] }] },
        { ...second!, groups: [] },
        third!,
      ],
    });
    const lines = reviewRequest(source, answer, ROLE, NOW).input.split('\n');
    const header = lines.findIndex((line) =>
      line.startsWith('Bullets of the company, shared by jobs 1–2'),
    );
    expect(header).toBeGreaterThan(lines.findIndex((line) => line.startsWith('Job 2 ')));
    expect(lines[header + 1]).toContain('[job.1.1] (unchanged, from S6)');
  });

  it('both models get the current month in their input, outside the cached source', () => {
    const requests = [
      authorRequest(source, ROLE, NOW),
      reviewRequest(source, authorAnswer(), ROLE, NOW),
    ];
    for (const request of requests) {
      expect(request.input).toContain('<current_month>2026-10</current_month>');
      expect(request.cached).toBe(source.cached);
    }
  });

  it('the reviewer sees kept items marked as unchanged and every job field with its id', () => {
    const request = reviewRequest(source, authorAnswer(), ROLE, NOW);
    expect(request.input).toContain('[job.1.1] (unchanged, from S6)');
    expect(request.input).toContain('[job.2.1] (rewritten, evidence S9, S10)');
    expect(request.input).toContain('[job.3.dates] 2015 – 2019');
  });
});
