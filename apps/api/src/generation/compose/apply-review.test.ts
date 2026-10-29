import { describe, expect, it } from 'vitest';
import { groupedAnswer, SOURCE_WITH_PROJECTS } from '../../../test/generation/compose-fixture.js';
import { applyReview } from './apply-review.js';
import { compose, prepareSource } from './compose.js';
import { buildDraft } from './draft.js';
import { reviewView, type ReviewOutput } from './review.js';

const ROLE = 'Senior Backend Engineer';
const source = prepareSource(SOURCE_WITH_PROJECTS);

const review = (
  action: 'fix' | 'ask',
  item: string,
  text: string | null,
  question: string | null = null,
): ReviewOutput => ({
  issues: [{ item, action, class: 'other', text, segments: [], question }],
});

const run = (output: ReviewOutput) => compose(source, groupedAnswer(), output, ROLE);

describe('applyReview — group titles and entries', () => {
  it('asks for the dates of an education entry as dates, so the answer sets them', () => {
    const answer = groupedAnswer({
      education: [
        {
          institution: 'Pinecrest College',
          degree: 'BSc',
          start: '2010',
          end: '2014',
          segments: ['S1'],
        },
      ],
    });
    const { questions } = compose(source, answer, review('ask', 'edu.1.dates', null), ROLE);
    expect(questions).toEqual([
      expect.objectContaining({
        target: { section: 'education', itemId: 'e1', field: 'dates' },
        answerType: 'dates',
      }),
    ]);
  });

  it('keeps an untitled entry whose every line is asked about, so the answer has a place to go', () => {
    const [section] = groupedAnswer().additional;
    const [entry] = section!.entries;
    const answer = groupedAnswer({
      additional: [{ ...section!, entries: [{ ...entry!, title: '', start: '', end: '' }] }],
    });
    const { document, questions } = compose(
      source,
      answer,
      review('ask', 'extra.1.1.1', null),
      ROLE,
    );
    expect(questions[0]?.target).toMatchObject({ section: 'additional', itemId: 'a1-e1-g1' });
    expect(document.additional[0]?.entries.map((kept) => kept.id)).toEqual(['a1-e1']);
  });

  it('a fix of a group title replaces the title and keeps its bullets', () => {
    const { document, questions } = run(review('fix', 'job.1.g1', 'Shipping'));
    expect(document.experience[0]?.groups[0]).toMatchObject({
      title: 'Shipping',
      items: [{ text: 'Cut report generation from 40 to 6 minutes by moving jobs to a queue' }],
    });
    expect(questions).toEqual([]);
  });

  it('an ask on a group title drops the title, keeps the bullets and asks nothing', () => {
    const ask = review('ask', 'job.1.g1', null, 'Was it delivery?');
    // Nothing is taken out, so nothing may reach the questions or "Not in your CV" past their cap.
    const draft = buildDraft(groupedAnswer(), source.index, source.text, ROLE);
    expect(applyReview(draft, ask, reviewView(draft), ROLE)).toEqual([]);
    const { document, questions } = run(ask);
    expect(
      document.experience[0]?.groups.map((group) => [group.title, group.items.length]),
    ).toEqual([
      [null, 1],
      [null, 1],
    ]);
    expect(questions).toEqual([]);
  });

  it('an ask on the dates of an entry empties them and asks for dates', () => {
    const { document, questions } = run(review('ask', 'extra.1.1.dates', null));
    expect(document.additional[0]?.entries[0]).toMatchObject({
      title: 'Proofing Timer',
      start: null,
      end: null,
    });
    expect(questions).toEqual([
      {
        kind: 'missing',
        target: { section: 'additional', itemId: 'a1-e1', field: 'dates' },
        prompt: 'When was this?',
        context: '2022 – 2023',
        answerType: 'dates',
      },
    ]);
  });

  it('an ask on the title of an entry empties it and asks for it as text', () => {
    const { document, questions } = run(review('ask', 'extra.1.1.title', null, 'Its name?'));
    expect(document.additional[0]?.entries[0]?.title).toBe('');
    expect(questions).toEqual([
      expect.objectContaining({
        target: { section: 'additional', itemId: 'a1-e1', field: 'title' },
        prompt: 'Its name?',
        context: 'Proofing Timer',
        answerType: 'text',
      }),
    ]);
  });

  it('keeps an entry whose only title is asked about, so the answer has a place to go', () => {
    const answer = groupedAnswer();
    answer.additional[0]!.entries[0]!.groups = [];
    const ask = review('ask', 'extra.1.1.title', null);
    const { document, questions } = compose(source, answer, ask, ROLE);
    expect(document.additional[0]?.entries).toEqual([
      expect.objectContaining({ id: 'a1-e1', title: '', start: '2022', end: '2023' }),
    ]);
    expect(questions).toEqual([
      expect.objectContaining({
        target: { section: 'additional', itemId: 'a1-e1', field: 'title' },
      }),
    ]);
  });

  it.each([
    ['a fix replaces it, without the colon the template adds', 'fix', 'Storage:', 'Storage'],
    ['an ask drops it and keeps the skills, asking nothing', 'ask', null, null],
  ] as const)('a skill group title: %s', (_case, action, text, title) => {
    const answer = groupedAnswer({ skills: [{ title: 'Data', segments: ['S14'], items: [] }] });
    const { document, questions } = compose(
      source,
      answer,
      review(action, 'skills.1.title', text),
      ROLE,
    );
    expect(document.skills[0]).toMatchObject({ title, items: [{ name: 'Go' }, {}, {}] });
    expect(questions).toEqual([]);
  });

  it('drops an empty entry whose question fell past the cap: no answer will come for it', () => {
    const answer = groupedAnswer();
    Object.assign(answer.additional[0]!.entries[0]!, { start: '', end: '', groups: [] });
    const fields = ['title', 'company', 'location', 'dates'];
    const asks = [1, 2, 3].flatMap((job) => fields.map((field) => `job.${job}.${field}`));
    const output: ReviewOutput = {
      issues: [...asks.slice(0, 10), 'extra.1.1.title'].map((item) => ({
        item,
        action: 'ask' as const,
        class: 'other' as const,
        text: null,
        segments: [],
        question: null,
      })),
    };
    const { document, questions } = compose(source, answer, output, ROLE);
    expect(questions).toHaveLength(10);
    expect(document.additional).toEqual([]);
  });

  it('a fix of the dates of an entry sets them', () => {
    const fix = review('fix', 'extra.1.1.dates', '2021-04 – 2022-01');
    fix.issues[0]!.segments = ['S17'];
    expect(run(fix).document.additional[0]?.entries[0]).toMatchObject({
      start: '2021-04',
      end: '2022-01',
    });
  });
});
