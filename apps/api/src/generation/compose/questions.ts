import type { QuestionTarget } from '@cv/shared';
import type { Asked } from './apply-review.js';
import type { Place } from './review.js';
import type { AuthorOutput } from './author-schema.js';
import { additionalId, educationId, positionId, type Draft, type DraftJob } from './draft.js';

export interface NewQuestion {
  kind: 'missing' | 'vague' | 'unverified';
  target: QuestionTarget;
  prompt: string;
  context: string | null;
  answerType: 'dates' | 'text';
}

export const MAX_QUESTIONS = 10;

const PROMPTS = {
  unverified:
    'We could not confirm this from your CV, so we left it out. If it is true, tell us what exactly you did.',
  dates: 'When did you start and finish this job? Leave the end empty if you still work there.',
  company: 'What is the name of the company?',
  title: 'What was your job title?',
  location: 'Where was this job?',
  institution: 'What is the name of the school or university?',
  degree: 'What degree or programme did you study?',
  educationDates: 'When did you study there?',
  entryTitle: 'What is the name of this project, course or certificate?',
  entryDates: 'When was this?',
  vague: 'This is vague. What exactly did you do, and what was the result?',
} as const;

/** "Senior Engineer — Acme Corp"; the label of a position in questions. */
export function positionLabel(job: { title: string; company: string }): string {
  return [job.title, job.company].filter(Boolean).join(' — ') || 'Position';
}

const datesIncomplete = (job: DraftJob) => job.start === null || (job.end === null && !job.current);

/**
 * Questions of a generation (docs/specs/generation.md §5), at most 10: the reviewer's first, then the
 * author's gaps in its order, then one safety net — a job without dates or a company that nobody asked
 * about (the task requires asking for missing information). Findings past the cap are returned, so
 * "Not in your CV" can show what they took out.
 */
export function buildQuestions(
  draft: Draft,
  asked: readonly Asked[],
  gaps: AuthorOutput['gaps'],
): { questions: NewQuestion[]; unasked: Asked[] } {
  const questions: NewQuestion[] = [];
  const keys = new Set<string>();
  // A field is asked about once. Every finding of the reviewer is its own question, whatever its prompt
  // (two doubtful bullets of one job are two questions): it has taken something out of the CV.
  let fromFindings = true;
  const push = (question: NewQuestion) => {
    const key = JSON.stringify([
      question.target,
      question.kind === 'missing' ? '' : question.prompt,
    ]);
    if (keys.has(key) && !fromFindings) return;
    keys.add(key);
    questions.push(question);
  };
  const job = (i: number, field?: string): QuestionTarget => ({
    section: 'experience',
    itemId: positionId(i),
    ...(field ? { field } : {}),
  });
  const missing = (
    target: QuestionTarget,
    prompt: string,
    context: string | null,
    answerType: 'dates' | 'text' = 'text',
  ) => {
    push({ kind: 'missing', target, prompt, context, answerType });
  };

  // An answer cannot rewrite a list of skills (§5), so a doubtful skill group is not asked about: it goes
  // to "Not in your CV" with the reviewer's question, where "Add" puts it back.
  // A line read as a heading has no part to rewrite either: "Not in your CV" lists it with the reason.
  const unanswerable = (item: Asked) =>
    item.target.kind === 'skills' || item.target.kind === 'heading';
  const findings = asked.filter((item) => !unanswerable(item));
  for (const item of findings) {
    const { target } = item;
    if (target.kind === 'field') {
      const label = positionLabel(draft.experience[target.job] ?? { title: '', company: '' });
      const prompt = item.question ?? PROMPTS[target.field];
      missing(
        job(target.job, target.field),
        prompt,
        item.context || label,
        target.field === 'dates' ? 'dates' : 'text',
      );
    } else if (target.kind === 'education') {
      const prompt =
        item.question ??
        (target.field === 'dates' ? PROMPTS.educationDates : PROMPTS[target.field]);
      missing(
        { section: 'education', itemId: educationId(target.entry), field: target.field },
        prompt,
        item.context || null,
        target.field === 'dates' ? 'dates' : 'text',
      );
    } else if (target.kind === 'entry') {
      missing(
        {
          section: 'additional',
          itemId: `${additionalId(target.section)}-e${target.entry + 1}`,
          field: target.field,
        },
        item.question ?? (target.field === 'dates' ? PROMPTS.entryDates : PROMPTS.entryTitle),
        item.context || null,
        target.field === 'dates' ? 'dates' : 'text',
      );
    } else if (target.kind === 'item') {
      const { place } = target;
      push({
        kind: 'unverified',
        target: findingTarget(place),
        prompt: item.question ?? PROMPTS.unverified,
        context: item.context,
        answerType: 'text',
      });
    }
    // A doubtful group title is dropped without a question (apply-review.ts); skills are left out above.
  }

  fromFindings = false;

  for (const gap of gaps) {
    const position = gap.job > 0 ? draft.experience[gap.job - 1] : undefined;
    const index = gap.job - 1;
    if (gap.kind === 'vague') {
      push({
        kind: 'vague',
        target: position ? job(index) : { section: 'summary' },
        prompt: gap.question || PROMPTS.vague,
        context: position ? positionLabel(position) : null,
        answerType: 'text',
      });
    } else if (gap.kind === 'missing_institution') {
      const entry = gap.education > 0 ? draft.education[gap.education - 1] : undefined;
      if (entry?.institution === '') {
        missing(
          {
            section: 'education',
            itemId: educationId(gap.education - 1),
            field: 'institution',
          },
          gap.question || PROMPTS.institution,
          entry.degree || null,
        );
      }
    } else if (position) {
      // A gap the draft has since filled (the author's own field, or a fix) is not asked.
      if (gap.kind === 'missing_dates' && datesIncomplete(position)) {
        missing(
          job(index, 'dates'),
          gap.question || PROMPTS.dates,
          positionLabel(position),
          'dates',
        );
      }
      if (gap.kind === 'missing_company' && position.company === '') {
        missing(job(index, 'company'), gap.question || PROMPTS.company, positionLabel(position));
      }
      if (gap.kind === 'missing_title' && position.title === '') {
        missing(job(index, 'title'), gap.question || PROMPTS.title, positionLabel(position));
      }
    }
  }

  draft.experience.forEach((position, i) => {
    if (datesIncomplete(position))
      missing(job(i, 'dates'), PROMPTS.dates, positionLabel(position), 'dates');
    if (position.company === '')
      missing(job(i, 'company'), PROMPTS.company, positionLabel(position));
  });
  // Findings come first and each is exactly one question, so the ones past the cap are the last findings.
  // `unasked`: what findings took out of the CV with no question to bring it back — skill groups, and
  // the findings past the cap; "Not in your CV" lists both.
  return {
    questions: questions.slice(0, MAX_QUESTIONS),
    unasked: [...asked.filter(unanswerable), ...findings.slice(MAX_QUESTIONS)],
  };
}

/**
 * Where the answer to a doubtful item lands: its group (a job's `p1-g2`, an entry's `a1-e1-g1`), so the
 * answer rewrites that group only (§5), at the item's place; the summary as a whole; a section
 * otherwise.
 */
function findingTarget(place: Place): QuestionTarget {
  if (place.section === 'experience') {
    const owner = positionId(place.job);
    if (place.group === undefined) return { section: 'experience', itemId: owner };
    return {
      section: 'experience',
      itemId: `${owner}-g${place.group + 1}`,
      ...positionIn(place),
    };
  }
  if (place.section === 'additional') {
    const section = additionalId(place.index);
    if (place.entry === undefined) return { section: 'additional', itemId: section };
    const entry = `${section}-e${place.entry + 1}`;
    if (place.group === undefined) return { section: 'additional', itemId: entry };
    return {
      section: 'additional',
      itemId: `${entry}-g${place.group + 1}`,
      ...positionIn(place),
    };
  }
  return { section: place.section };
}

/** The item's index in its group as the review saw it; the answer counts the earlier ones not back yet. */
function positionIn(place: Extract<Place, { section: 'experience' | 'additional' }>): {
  position?: number;
} {
  return place.item === undefined ? {} : { position: place.item };
}
