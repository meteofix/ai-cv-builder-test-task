import { contentLines, type Fact } from '../grounding/index.js';
import type { SourceFacts } from '../generation/generate/schemas.js';
import { buildQuestions } from '../generation/generate/questions.js';
import { buildSkeleton } from '../generation/generate/skeleton.js';
import type { Expected } from './expected.js';
import { matchPositions, type FoundPosition, type PositionMatch } from './position-match.js';

export interface ExtractionMetrics {
  kept: number;
  dropped: Record<string, number>;
  /** Achievements moved to another position because theirs was not kept, and those left without one. */
  placed: { reattached: number; unplaced: number };
  /** Lines with a letter that are not a section heading, each text once (as `uncoveredLines` counts). */
  contentLines: number;
  uncovered: number;
  positions: FoundPosition[];
  matches: PositionMatch[];
  achievements: number;
  skills: number;
  education: number;
  other: number;
  profile: number;
  contactsMissing: string[];
  /** Questions the draft alone would raise, by kind: dates, company, title. */
  questions: Record<string, number>;
  expected: Expected | null;
}

type FactOf<K extends Fact['kind']> = Extract<Fact, { kind: K }>;

/** What one extraction found, next to what a reader expects of the CV. */
export function measureExtraction(input: {
  text: string;
  stored: SourceFacts;
  dropped: Record<string, number>;
  placed: ExtractionMetrics['placed'];
  expected: Expected | null;
}): ExtractionMetrics {
  const { text, stored, expected } = input;
  const facts = stored.facts;
  const of = <K extends Fact['kind']>(kind: K) =>
    facts.filter((fact): fact is FactOf<K> => fact.kind === kind);
  const achievementsOf = (positionId: string) =>
    of('achievement').filter((fact) => fact.achievement.positionId === positionId).length;
  const positions = of('position').map((fact): FoundPosition => ({
    id: fact.id,
    ...fact.position,
    bullets: achievementsOf(fact.id),
  }));
  const draft = buildSkeleton({ source: text, facts, targetRole: 'eval', locale: stored.locale });
  const questions: Record<string, number> = {};
  for (const question of buildQuestions({
    source: text,
    document: draft,
    facts,
    removed: [],
    notCurrent: new Set(),
  })) {
    // Every position of a draft is without bullets; only the structural questions mean something here.
    const field = question.target.field;
    if (field) questions[field] = (questions[field] ?? 0) + 1;
  }
  const contactFields = new Set(of('contact').map((fact) => fact.contact.field));
  return {
    kept: facts.length,
    dropped: input.dropped,
    placed: input.placed,
    contentLines: contentLines(text, stored.sectionHeadings).length,
    uncovered: stored.uncoveredLines.length,
    positions,
    matches: expected ? matchPositions(expected.positions, positions) : [],
    achievements: of('achievement').length,
    skills: of('skill').length,
    education: of('education').length,
    other: of('other').length,
    profile: of('profile').length,
    contactsMissing: (expected?.contacts ?? []).filter((field) => !contactFields.has(field)),
    questions,
    expected,
  };
}

/** found / expected as a whole percentage; "—" when nothing is expected. */
export function ratio(found: number, expected: number): string {
  return expected === 0 ? '—' : `${Math.round((found / expected) * 100)}%`;
}
