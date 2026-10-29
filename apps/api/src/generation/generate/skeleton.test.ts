import { bulletsOf, cvDocumentSchema, LIMITS } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import type { Fact } from '../../grounding/index.js';
import { buildSkeleton, type Prose } from './skeleton.js';

const SOURCE = 'x'.repeat(5000);
let next = 0;
const span = (): [number, number] => [next, ++next];

function position(id: string, current = false): Fact {
  return {
    id,
    kind: 'position',
    quote: id,
    span: span(),
    position: {
      company: `Company ${id}`,
      title: 'Engineer',
      location: null,
      start: '2020',
      end: '2021',
      current,
    },
  };
}
const skill = (id: string): Fact => ({
  id,
  kind: 'skill',
  quote: id,
  span: span(),
  skill: { name: id },
});
const link = (value: string): Fact => ({
  id: value,
  kind: 'contact',
  quote: value,
  span: span(),
  contact: { field: 'link', value },
});

function build(facts: Fact[], prose?: Prose, source = SOURCE, locale: 'en' | 'uk' = 'en') {
  const document = buildSkeleton({ source, facts, targetRole: 'Engineer', locale, prose });
  expect(cvDocumentSchema.safeParse(document).success).toBe(true);
  return document;
}

describe('buildSkeleton', () => {
  it('cuts lists at their limits in order', () => {
    const positions = Array.from({ length: LIMITS.maxExperience + 2 }, (_, i) => position(`p${i}`));
    const skills = Array.from({ length: LIMITS.maxSkills + 1 }, (_, i) => skill(`s${i}`));
    const document = build([...positions, ...skills]);
    expect(document.experience.map((job) => job.id)).toEqual(
      positions.slice(0, LIMITS.maxExperience).map((fact) => fact.id),
    );
    expect(document.skills[0]?.items).toHaveLength(LIMITS.maxSkills);
  });

  it('copies structure from facts with the fact id as item id, and clears the end of a current job', () => {
    const document = build([position('p1', true)]);
    expect(document.experience[0]).toEqual({
      id: 'p1',
      factId: 'p1',
      company: 'Company p1',
      title: 'Engineer',
      start: '2020',
      end: null,
      current: true,
      groups: [{ id: 'p1-g1', title: null, items: [] }],
    });
  });

  it('keeps the source order of positions and follows the writer’s skill selection', () => {
    const prose: Prose = {
      summary: [{ id: 's1', text: 'Engineer.', factIds: ['p2'] }],
      bullets: new Map([['p2', [{ id: 'b1', text: 'Shipped.', factIds: ['p2'] }]]]),
      skills: ['go'],
    };
    const document = build([position('p1'), position('p2'), skill('sql'), skill('go')], prose);
    // The writer no longer orders the jobs (decision 033): the CV keeps the order of the source.
    expect(document.experience.map((job) => job.id)).toEqual(['p1', 'p2']);
    expect(bulletsOf(document.experience[1]!)).toEqual([
      { id: 'b1', text: 'Shipped.', factIds: ['p2'] },
    ]);
    expect(document.skills.flatMap((group) => group.items.map((item) => item.name))).toEqual([
      'go',
    ]);
    expect(document.summary).toEqual({ text: 'Engineer.', factIds: ['p2'] });
  });

  it('keeps summary sentences only while they fit the limit', () => {
    const long = 'a'.repeat(LIMITS.maxSummaryChars - 10);
    const prose: Prose = {
      summary: [
        { id: 's1', text: long, factIds: ['p1'] },
        { id: 's2', text: 'This sentence does not fit.', factIds: ['p2'] },
      ],
      bullets: new Map(),
      skills: null,
    };
    expect(build([position('p1')], prose).summary).toEqual({
      text: long,
      factIds: ['p1'],
    });
  });

  it.each([
    ['github.com/iryna', 'https://github.com/iryna'],
    ['https://iryna.dev', 'https://iryna.dev'],
    ['mailto:iryna@example.com', 'mailto:iryna@example.com'],
  ])('turns the link %j into %j', (value, expected) => {
    expect(build([link(value)]).contacts.links).toEqual([expected]);
  });

  it('leaves out links the schema does not allow', () => {
    expect(
      build([link('javascript:alert(1)'), link('ftp://files.example.com')]).contacts.links,
    ).toEqual([]);
  });

  it('copies extra sections verbatim from the source, with the heading only when it is in the source', () => {
    const source = 'Certificates\nAWS  Certified\nКурси\nReact course';
    const other = (quote: string, section: string, at: number): Fact => ({
      id: quote,
      kind: 'other',
      quote,
      span: [at, at + quote.length + (quote === 'AWS Certified' ? 1 : 0)],
      other: { section },
    });
    const document = build(
      [
        other('AWS Certified', 'Certificates', 13),
        other('React course', 'Invented heading', source.indexOf('React')),
      ],
      undefined,
      source,
    );
    expect(
      document.additional.map(({ title, entries }) => [
        title,
        entries.flatMap((entry) => bulletsOf(entry).map((line) => line.text)),
      ]),
    ).toEqual([
      ['Certificates', ['AWS Certified']],
      ['Additional information', ['React course']],
    ]);
  });

  it('uses the Ukrainian fallback title for a Ukrainian CV', () => {
    const source = 'Курс React';
    const fact: Fact = {
      id: 'o',
      kind: 'other',
      quote: source,
      span: [0, source.length],
      other: { section: 'Навчання' },
    };
    expect(build([fact], undefined, source, 'uk').additional[0]?.title).toBe(
      'Додаткова інформація',
    );
  });
});
