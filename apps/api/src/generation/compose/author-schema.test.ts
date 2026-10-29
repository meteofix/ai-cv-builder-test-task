import { LIMITS } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import { authorAnswer, SOURCE } from '../../../test/generation/compose-fixture.js';
import { authorSchema } from './author-checks.js';
import {
  authorOutputSchema,
  dateOf,
  groupSkills,
  kept,
  type AuthorGroup,
  type AuthorOutput,
} from './author-schema.js';
import { prepareSource } from './compose.js';

const schema = authorSchema(prepareSource(SOURCE).index);

/** The issues of an answer as `path: message`, so a case can name where the refusal points. */
function issues(answer: AuthorOutput): string[] {
  const result = schema.safeParse(answer);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

/** The first job of the fixture with other groups or fields. */
const firstJob = (change: Partial<AuthorOutput['experience'][number]>): AuthorOutput =>
  authorAnswer({
    experience: [
      { ...authorAnswer().experience[0]!, ...change },
      ...authorAnswer().experience.slice(1),
    ],
  });

/** `count` groups of `size` kept bullets each. */
const groups = (count: number, size: number): AuthorGroup[] =>
  Array.from({ length: count }, (_, g) => ({
    title: `Group ${g + 1}`,
    items: Array.from({ length: size }, () => ({ text: '', segments: ['S6'] })),
  }));

/** An extra entry that cites the hobbies line; tests change its title or groups. */
const entry = (change: Partial<AuthorOutput['additional'][number]['entries'][number]>) => ({
  title: '',
  start: '',
  end: '',
  segments: ['S15'],
  groups: [{ title: '', items: [{ text: '', segments: ['S15'] }] }],
  ...change,
});

describe('authorOutputSchema — what an omitted field means', () => {
  it('reads an omitted string as "" (none) instead of re-asking', () => {
    const omitted = new Set(['orderReason', 'structureNotes', 'location', 'end', 'question']);
    const answer = authorAnswer({
      gaps: [{ kind: 'vague', job: 1, education: 0, question: 'What did you ship?' }],
    });
    const parsed = authorOutputSchema.parse(
      JSON.parse(
        JSON.stringify(answer, (key, value: unknown) => (omitted.has(key) ? undefined : value)),
      ),
    );
    expect(parsed).toMatchObject({ orderReason: '', structureNotes: '', gaps: [{ question: '' }] });
    expect(parsed.experience[0]).toMatchObject({ location: '', end: '' });
  });
});

describe('dateOf and kept — "" means none', () => {
  it.each([
    ['', null],
    ['2021', '2021'],
    ['2021-05', '2021-05'],
  ])('reads the date %j as %j', (value, expected) => {
    expect(dateOf(value)).toBe(expected);
  });

  it.each([
    ['', true],
    ['   ', true],
    ['Mentored two developers', false],
  ])('treats the text %j as kept: %s', (text, expected) => {
    expect(kept({ text, segments: ['S7'] })).toBe(expected);
  });
});

describe('groupSkills — the skills of a group', () => {
  it('leaves out a label that stands on a line of its own, as a two-column PDF prints it', () => {
    const source = prepareSource('Daily use:\nC, C++, CSS');
    const group = { title: 'Daily use', segments: ['S1', 'S2'], items: [] };
    expect(groupSkills(group, source.index)).toEqual(['C', 'C++', 'CSS']);
  });

  it.each([
    [true, ['Rust', 'Go', 'Apache Cassandra', 'Elixir']],
    [false, ['Rust', 'Go', 'Apache', 'Cassandra', 'Elixir']],
  ])(
    'joins the lines of a kept group before cutting it when wrapped is %s',
    (wrapped, expected) => {
      const source = prepareSource('Rust, Go, Apache\nCassandra, Elixir');
      const group = { title: '', segments: ['S1', 'S2'], items: [], wrapped };
      expect(groupSkills(group, source.index)).toEqual(expected);
    },
  );
});

describe('authorSchema — the rules the grammar cannot hold', () => {
  it('accepts the limits themselves: 10 groups, 20 bullets across groups', () => {
    expect(issues(firstJob({ groups: groups(LIMITS.maxGroupsPerList, 2) }))).toEqual([]);
  });

  it.each([
    [
      'more than 10 groups in a job',
      firstJob({ groups: groups(LIMITS.maxGroupsPerList + 1, 1) }),
      'experience.0.groups: More than 10 groups',
    ],
    [
      'more than 20 bullets across the groups of a job',
      firstJob({ groups: groups(3, 7) }),
      'experience.0.groups: More than 20 bullets',
    ],
    [
      'a date that is not YYYY or YYYY-MM',
      firstJob({ start: '2021/05' }),
      'experience.0.start: Use YYYY or YYYY-MM, or "", not "2021/05"',
    ],
    [
      'a field over 200 characters',
      firstJob({ title: 'x'.repeat(LIMITS.maxFieldChars + 1) }),
      'experience.0.title: Longer than 200 characters',
    ],
    [
      'an order note over 200 characters',
      authorAnswer({ orderReason: 'x'.repeat(LIMITS.maxFieldChars + 1) }),
      'orderReason: Longer than 200 characters',
    ],
    [
      'structure notes over 2000 characters',
      authorAnswer({ structureNotes: 'x'.repeat(LIMITS.maxTextChars + 1) }),
      'structureNotes: Longer than 2000 characters',
    ],
    [
      'a group title over 200 characters',
      firstJob({ groups: [{ title: 'x'.repeat(201), items: [{ text: '', segments: ['S6'] }] }] }),
      'experience.0.groups.0.title: Longer than 200 characters',
    ],
    [
      'more than 20 lines across the groups of an entry',
      authorAnswer({
        additional: [{ title: 'Hobbies', entries: [entry({ groups: groups(3, 7) })] }],
      }),
      'additional.0.entries.0.groups: More than 20 lines',
    ],
    [
      'an entry with neither a title nor a line, which the document would drop',
      authorAnswer({ additional: [{ title: 'Hobbies', entries: [entry({ groups: [] })] }] }),
      'additional.0.entries.0: Give the entry a title or at least one line',
    ],
    [
      'a skill group that names no skill, which the document would drop',
      authorAnswer({ skills: [{ title: 'Tools', segments: ['S14'], items: [' '] }] }),
      'skills.0: Name at least one skill',
    ],
  ])('refuses %s', (_case, answer, expected) => {
    expect(issues(answer)).toEqual([expected]);
  });

  it('accepts 20 lines across the groups of an entry, and an entry that is only a title', () => {
    const entries = [entry({ groups: groups(4, 5) }), entry({ title: 'Sourdough', groups: [] })];
    expect(issues(authorAnswer({ additional: [{ title: 'Hobbies', entries }] }))).toEqual([]);
  });

  it.each([
    ['gaps', 'education', { kind: 'vague', job: 1, question: 'What was the result?' }],
    ['gaps', 'job', { kind: 'vague', education: 0, question: 'What was the result?' }],
    ['notIncluded', 'job', { segments: ['S15'], section: 'additional', reason: 'A hobby' }],
  ] as const)('reads an omitted %s.%s as 0 instead of asking again', (list, key, entry) => {
    const parsed = schema.parse({ ...authorAnswer(), [list]: [entry] });
    expect(parsed[list][0]).toEqual({ ...entry, [key]: 0 });
  });

  it('keeps structure notes out of the field limit: they are notes for evals, not a field', () => {
    expect(issues(authorAnswer({ structureNotes: 'x'.repeat(LIMITS.maxFieldChars + 1) }))).toEqual(
      [],
    );
  });

  it('does not apply the field limit to an item text, which has its own', () => {
    const text = 'x'.repeat(LIMITS.maxFieldChars + 1);
    expect(
      issues(firstJob({ groups: [{ title: '', items: [{ text, segments: ['S6'] }] }] })),
    ).toEqual([]);
  });
});
