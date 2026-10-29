import { cvDocumentSchema } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import { authorAnswer, SOURCE } from '../../../test/generation/compose-fixture.js';
import { compose, prepareSource, reviewRequest } from './compose.js';
import type { ReviewOutput } from './review.js';

const ROLE = 'Senior Backend Engineer';
const NO_ISSUES: ReviewOutput = { issues: [] };
const source = prepareSource(SOURCE);

describe('compose — kept text and structure', () => {
  it('fills kept items with the source text, list markers removed and wrapped lines joined', () => {
    const { document } = compose(
      source,
      authorAnswer({
        experience: [
          { ...authorAnswer().experience[1]!, bullets: [{ text: null, segments: ['S9', 'S10'] }] },
        ],
      }),
      NO_ISSUES,
      ROLE,
    );
    expect(document.experience[0]?.bullets[0]).toMatchObject({
      text: 'I was the person who kept our PostgreSQL fast and answered everyone’s database questions',
      factIds: ['S9', 'S10'],
    });
  });

  it.each(['• ', '▪ ', '- ', '* ', '– ', '1. '])(
    'removes the list marker %j from a kept line',
    (marker) => {
      const marked = prepareSource(SOURCE.replace('• Mentored', `${marker}Mentored`));
      const { document } = compose(marked, authorAnswer(), NO_ISSUES, ROLE);
      expect(document.experience[0]?.bullets[1]?.text).toBe('Mentored two junior developers');
    },
  );

  it('keeps a rewritten item as written, citing its evidence', () => {
    const { document } = compose(source, authorAnswer(), NO_ISSUES, ROLE);
    expect(document.experience[1]?.bullets[0]?.text).toBe(
      'Kept PostgreSQL fast; the team’s go-to person for database questions',
    );
    expect(document.experience[0]?.bullets.map((bullet) => bullet.text)).toEqual([
      'Cut report generation from 40 to 6 minutes by moving jobs to a queue',
      'Mentored two junior developers',
    ]);
  });

  it('cuts a kept skill group into skills without breaking brackets', () => {
    const { document } = compose(source, authorAnswer(), NO_ISSUES, ROLE);
    expect(document.skills.map((skill) => skill.name)).toEqual([
      'Go',
      'PostgreSQL (tuning, replication)',
      'Kafka',
    ]);
  });

  it('cuts each kept line of a group on its own, so every line loses its label', () => {
    const labelled = prepareSource(`${SOURCE}\nLanguages: English, Polish\nTools: Git, Docker`);
    const answer = authorAnswer({ skills: [{ title: '', segments: ['S16', 'S17'], items: [] }] });
    const { document } = compose(labelled, answer, NO_ISSUES, ROLE);
    expect(document.skills.map((skill) => skill.name)).toEqual([
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
    expect(document.experience[1]?.bullets[0]?.text).toBe(
      'Kept PostgreSQL fast and answered database questions',
    );
    expect(questions).toEqual([]);
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
    expect(document.experience[0]?.bullets.map((bullet) => bullet.text)).toEqual([
      'Mentored two junior developers',
    ]);
    expect(questions[0]).toEqual({
      kind: 'unverified',
      target: { section: 'experience', itemId: 'p1' },
      prompt: 'Was it 6 minutes for every report?',
      context: 'Cut report generation from 40 to 6 minutes',
      answerType: 'text',
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
    const own = authorAnswer({ headline: { text: null, segments: ['S5'] } });
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
        { ...first!, bullets: [{ text: null, segments: ['S6'] }] },
        { ...second!, bullets: [] },
        third!,
      ],
    });
    const lines = reviewRequest(source, answer, ROLE).input.split('\n');
    const header = lines.findIndex((line) =>
      line.startsWith('Bullets of the company, shared by jobs 1–2'),
    );
    expect(header).toBeGreaterThan(lines.findIndex((line) => line.startsWith('Job 2 ')));
    expect(lines[header + 1]).toContain('[job.1.1] (unchanged, from S6)');
  });

  it('the reviewer sees kept items marked as unchanged and every job field with its id', () => {
    const request = reviewRequest(source, authorAnswer(), ROLE);
    expect(request.input).toContain('[job.1.1] (unchanged, from S6)');
    expect(request.input).toContain('[job.2.1] (rewritten, evidence S9, S10)');
    expect(request.input).toContain('[job.3.dates] 2015 – 2019');
  });
});
