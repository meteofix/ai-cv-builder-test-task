import type { CvDocument, CvPosition, QuestionTarget } from '@cv/shared';
import type { Fact } from '../../grounding/index.js';
import type { RemovedItem } from './schemas.js';
import { verbatim } from './skeleton.js';

export interface NewQuestion {
  kind: 'missing' | 'vague' | 'unverified';
  target: QuestionTarget;
  prompt: string;
  context: string | null;
  answerType: 'dates' | 'text';
}

const MAX_QUESTIONS = 10;

const PROMPTS = {
  unverified:
    'We could not confirm this from your CV, so we left it out. If it is true, tell us what exactly you did.',
  dates: 'When did you start and finish this job? Leave the end empty if you still work there.',
  company: 'What is the name of the company?',
  title: 'What was your job title?',
  institution: 'What is the name of the school or university?',
  vague: 'This is vague. What exactly did you do, and what was the result?',
  noBullets: 'What did you achieve in this job? Name one or two concrete results.',
} as const;

/** "Senior Engineer — Acme Corp"; the label of a position in questions and in "Not in your CV". */
export function positionLabel(position: { title: string; company: string }): string {
  return [position.title, position.company].filter(Boolean).join(' — ') || 'Position';
}

/**
 * Questions from templates (docs/specs/generation.md §3.6), in priority order and at most 10: removed
 * prose, incomplete dates, empty names, vague facts, positions without a bullet.
 */
export function buildQuestions(input: {
  source: string;
  document: CvDocument;
  facts: readonly Fact[];
  removed: readonly RemovedItem[];
  /** Positions the judge did not confirm as current: their dates question comes first, past the cap. */
  notCurrent?: ReadonlySet<string>;
}): NewQuestion[] {
  const { document } = input;
  const questions: NewQuestion[] = [];
  const position = (itemId: string, field?: string): QuestionTarget => ({
    section: 'experience',
    itemId,
    ...(field ? { field } : {}),
  });

  const notCurrent = input.notCurrent ?? new Set<string>();
  const datesIncomplete = (job: CvPosition) =>
    job.start === null || (job.end === null && !job.current);
  // The CV no longer says "present" for these jobs: the user must see why, whatever else is asked.
  for (const job of document.experience) {
    if (notCurrent.has(job.id) && datesIncomplete(job)) {
      questions.push(missing(position(job.id, 'dates'), PROMPTS.dates, job, 'dates'));
    }
  }
  for (const item of input.removed) {
    questions.push({
      kind: 'unverified',
      target: item.positionId ? position(item.positionId) : { section: 'summary' },
      prompt: PROMPTS.unverified,
      context: item.text,
      answerType: 'text',
    });
  }
  for (const job of document.experience) {
    // A start with no end on a past job would print as a single month.
    if (!notCurrent.has(job.id) && datesIncomplete(job)) {
      questions.push(missing(position(job.id, 'dates'), PROMPTS.dates, job, 'dates'));
    }
  }
  for (const job of document.experience) {
    if (!job.company) questions.push(missing(position(job.id, 'company'), PROMPTS.company, job));
    if (!job.title) questions.push(missing(position(job.id, 'title'), PROMPTS.title, job));
  }
  for (const school of document.education) {
    if (!school.institution) {
      questions.push({
        kind: 'missing',
        target: { section: 'education', itemId: school.id, field: 'institution' },
        prompt: PROMPTS.institution,
        context: school.degree ?? null,
        answerType: 'text',
      });
    }
  }
  for (const fact of input.facts) {
    if (!fact.vague) continue;
    const itemId =
      fact.kind === 'achievement'
        ? fact.achievement.positionId
        : fact.kind === 'position'
          ? fact.id
          : null;
    if (!itemId) continue;
    questions.push({
      kind: 'vague',
      target: position(itemId),
      prompt: PROMPTS.vague,
      context: verbatim(input.source, fact),
      answerType: 'text',
    });
  }
  for (const job of document.experience) {
    if (job.bullets.length === 0) questions.push(missing(position(job.id), PROMPTS.noBullets, job));
  }
  return questions.slice(0, MAX_QUESTIONS);
}

function missing(
  target: QuestionTarget,
  prompt: string,
  job: CvPosition,
  answerType: 'dates' | 'text' = 'text',
): NewQuestion {
  return { kind: 'missing', target, prompt, context: positionLabel(job), answerType };
}
