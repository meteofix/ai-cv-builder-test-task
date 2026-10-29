import { describe, expect, it } from 'vitest';
import { groupedAnswer, SOURCE_WITH_PROJECTS } from '../../../test/generation/compose-fixture.js';
import { prepareSource } from './compose.js';
import { buildDraft } from './draft.js';
import { reviewSchema, reviewView } from './review.js';

const ROLE = 'Senior Backend Engineer';
const source = prepareSource(SOURCE_WITH_PROJECTS);
const view = () => reviewView(buildDraft(groupedAnswer(), source.index, source.text, ROLE));

describe('reviewView — groups and entries', () => {
  it('prints a titled group above its bullets, the bullets numbered across the groups', () => {
    const lines = view().text.split('\n');
    const title = lines.indexOf('[job.1.g1] (group title) "Delivery":');
    expect(title).toBeGreaterThan(-1);
    expect(lines[title + 1]).toMatch(/^\[job\.1\.1\] \(unchanged, from S6\)/);
    expect(lines[title + 2]).toMatch(/^\[job\.1\.2\] \(unchanged, from S7\)/);
  });

  it('gives a group without a title no id', () => {
    const { targets, text } = view();
    expect(targets.get('job.1.g1')).toMatchObject({ kind: 'title' });
    expect(targets.has('job.1.g2')).toBe(false);
    expect(text).not.toContain('job.1.g2');
  });

  it('prints the title and the dates of an entry, its group title and its lines', () => {
    const { targets, text } = view();
    expect(text).toContain(
      'Entry 1.1 (from S17): [extra.1.1.title] "Proofing Timer" · [extra.1.1.dates] 2022 – 2023',
    );
    expect(text).toContain('[extra.1.1.g1] (group title) "What it does":');
    expect(text).toContain('[extra.1.1.1] (unchanged, from S18)');
    expect(targets.get('extra.1.1.title')).toEqual({
      kind: 'entry',
      section: 0,
      entry: 0,
      field: 'title',
    });
    expect(targets.get('extra.1.1.dates')).toMatchObject({ kind: 'entry', field: 'dates' });
    expect(targets.get('extra.1.1.1')).toMatchObject({
      kind: 'item',
      place: { section: 'additional', index: 0 },
    });
  });

  it('prints a skill group title as a claim of its own above its skills', () => {
    const draft = buildDraft(
      groupedAnswer({ skills: [{ title: 'Data', segments: ['S14'], items: [] }] }),
      source.index,
      source.text,
      ROLE,
    );
    const { targets, text } = reviewView(draft);
    expect(text).toContain(
      '[skills.1.title] (group title) "Data":\n[skills.1] (unchanged, from S14) Go, PostgreSQL (tuning, replication), Kafka',
    );
    expect(targets.get('skills.1.title')).toEqual({ kind: 'title', group: draft.skills[0] });
  });

  /** The messages the reviewer's schema gives one fix; empty when it passes. */
  const problems = (item: string, text: string, segments: string[]) => {
    const issue = { item, action: 'fix' as const, class: 'other' as const, question: null };
    const result = reviewSchema(view(), source.index).safeParse({
      issues: [{ ...issue, text, segments }],
    });
    return result.success ? [] : result.error.issues.map((i) => i.message);
  };

  it('accepts a fix of a group title without segments: the title names the bullets under it', () => {
    expect(problems('job.1.g1', 'Shipping', [])).toEqual([]);
  });

  it.each([
    ['an entry title fixed without segments', 'extra.1.1.title', 'Timer', [], 'must cite'],
    ['entry dates that do not read as dates', 'extra.1.1.dates', 'last year', ['S17'], 'YYYY-MM'],
  ])('refuses %s', (_case, item, text, segments, problem) => {
    expect(problems(item, text, segments).join('\n')).toContain(problem);
  });
});

describe('reviewView — lines read as headings (decision 035, revised)', () => {
  it('lists the headings the CV shows nowhere, for the reviewer to say one is content', () => {
    // S14 (the skills line) is cited by a skill group, so it is shown; S4, S13 and S15 are not.
    const answer = groupedAnswer({ headings: ['S4', 'S13', 'S14', 'S15'] });
    const { text, targets } = reviewView(buildDraft(answer, source.index, source.text, ROLE));
    expect(text).toContain('[heading.S15] "Hobbies: sourdough"');
    expect(text).toContain('[heading.S4] "EXPERIENCE"');
    expect(text).not.toContain('heading.S14');
    expect(targets.get('heading.S15')).toEqual({
      kind: 'heading',
      segment: 'S15',
      text: 'Hobbies: sourdough',
    });
  });

  it('lists a heading once, and not one the author left out with a reason or one too long to be a heading', () => {
    const long =
      'A line far too long to be a heading of any section of this curriculum vitae, by a wide margin';
    const withLong = prepareSource(`${SOURCE_WITH_PROJECTS}\n${long}`);
    const longId = withLong.segments.at(-1)!.id;
    const answer = groupedAnswer({
      headings: ['S4', 'S4', 'S13', 'S15', longId],
      notIncluded: [{ segments: ['S15'], section: 'additional', job: 0, reason: 'A hobby' }],
    });
    const { text } = reviewView(buildDraft(answer, withLong.index, withLong.text, ROLE));
    expect(text.match(/\[heading\.S4\]/g)).toHaveLength(1);
    expect(text).not.toContain('heading.S15');
    expect(text).not.toContain(`heading.${longId}`);
  });

  it('takes an ask on a line read as a heading, and refuses a fix', () => {
    const answer = groupedAnswer({ headings: ['S4', 'S13', 'S15'] });
    const current = reviewView(buildDraft(answer, source.index, source.text, ROLE));
    const schema = reviewSchema(current, source.index);
    const issue = (action: 'fix' | 'ask') => ({
      issues: [
        {
          item: 'heading.S15',
          action,
          class: 'other' as const,
          text: 'x',
          segments: [],
          question: 'A hobby',
        },
      ],
    });
    expect(schema.safeParse(issue('ask')).success).toBe(true);
    expect(schema.safeParse(issue('fix')).success).toBe(false);
  });
});
