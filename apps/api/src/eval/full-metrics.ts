import type { CvDocument } from '@cv/shared';
import type { Expected } from './expected.js';
import type { FullRun } from './full-run.js';
import { matchPositions, type FoundPosition, type PositionMatch } from './position-match.js';

export interface FullMetrics {
  matches: PositionMatch[];
  /** The document lists its positions in the order of the source (the draft's); null without a draft. */
  sourceOrder: boolean | null;
  /** Source achievements the document's bullets cite, plus achievements listed as "Not used". */
  bullets: number;
  /** Skills in the document plus the ones the writer left out (every skill fact is in the draft). */
  skills: number | null;
  questions: Record<string, number>;
  notRecognized: number;
  unverified: string[];
  expected: Expected | null;
}

function positionsOf(document: CvDocument): FoundPosition[] {
  return document.experience.map((position) => ({
    id: position.id,
    company: position.company,
    title: position.title,
    start: position.start,
    end: position.end,
    current: position.current,
    bullets: position.bullets.length,
  }));
}

/** A question as a short kind: the asked field, "noBullets", "unverified" or "vague". */
function questionKind(question: FullRun['detail']['questions'][number]): string {
  if (question.kind !== 'missing') return question.kind;
  return question.target.field ?? 'noBullets';
}

/** Distinct facts the bullets cite besides their positions: one bullet may condense several. */
function citedAchievements(document: CvDocument | null): number {
  if (!document) return 0;
  const positions = new Set(document.experience.map((position) => position.factId));
  const cited = document.experience.flatMap((position) =>
    position.bullets.flatMap((bullet) => bullet.factIds),
  );
  return new Set(cited.filter((id) => !positions.has(id))).size;
}

export function measureFullRun(run: FullRun, expected: Expected | null): FullMetrics {
  const document = run.detail.document;
  const found = document ? positionsOf(document) : [];
  const documentOrder = found.map((position) => position.id);
  // The draft lists every kept position in source order; the document may show fewer of them.
  const inDraftOrder = run.draft?.experience
    .map((position) => position.id)
    .filter((id) => documentOrder.includes(id));
  const unused = run.notInCv.filter((item) => item.reason === 'unused');
  const questions: Record<string, number> = {};
  for (const question of run.detail.questions) {
    const kind = questionKind(question);
    questions[kind] = (questions[kind] ?? 0) + 1;
  }
  return {
    matches: expected ? matchPositions(expected.positions, found) : [],
    sourceOrder: inDraftOrder ? inDraftOrder.join() === documentOrder.join() : null,
    // An unused item with a position as its context is an achievement (generation.md §4.2).
    bullets:
      citedAchievements(document) + unused.filter((item) => item.context !== undefined).length,
    skills: run.draft?.skills.length ?? null,
    questions,
    notRecognized: run.notInCv.filter((item) => item.reason === 'not_recognized').length,
    unverified: run.notInCv
      .filter((item) => item.reason === 'unverified')
      .map((item) => `${item.context ?? ''}: ${item.text}`),
    expected,
  };
}
