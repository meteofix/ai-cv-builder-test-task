import type { EntityManager } from '@mikro-orm/postgresql';
import type { Answer, CvDocument, QuestionTarget } from '@cv/shared';

/** `unverified` asks about one item the review took out; `vague` about a group, a job or the summary. */
type QuestionKind = 'missing' | 'vague' | 'unverified';
import type { IUser } from '../../src/db/entities.js';
import type { SourceAnalysis } from '../../src/generation/compose/compose.js';
import { createCv, createJob, createQuestion } from '../support/factories.js';

/**
 * An invented CV the author and the reviewer wrote (docs/specs/generation.md §5). Segments: S1 the name,
 * S2 job A's line, S3–S4 its bullets, S5 a subsection heading, S6 its bullet, S7 job B's line, S8–S9 its
 * bullets, S10 a project. Job A has a plain group (two bullets citing segments and `u1`, which the person
 * wrote) and a titled group "Mentoring"; job B has one plain group.
 */
export const ANSWER_SOURCE = [
  'Iryna Kovalenko',
  'Senior Engineer, Acme Corp, 2021 – present',
  'Led the billing migration.',
  'Kept the weekly on-call schedule.',
  'Mentoring',
  'Mentored two new engineers.',
  'Engineer, Globex, 2018 – 2021',
  'Built the search service.',
  'Cut search latency by 30%.',
  'Trail app: offline maps for hikers',
].join('\n');

export const POSITION_A = 'p1';
export const POSITION_B = 'p2';
export const GROUP_A1 = 'p1-g1';
export const GROUP_A2 = 'p1-g2';
export const ENTRY = 'a1-e1';

const item = (id: string, text: string, factIds: string[]) => ({ id, text, factIds });

export function answerDocument(): CvDocument {
  return {
    locale: 'en',
    contacts: { fullName: 'Iryna Kovalenko', email: '', phone: '', location: '', links: [] },
    headline: 'Staff Engineer',
    summary: { text: 'Engineer who leads migrations.', factIds: ['S2', 'S3'] },
    experience: [
      {
        id: POSITION_A,
        factId: 'S2',
        company: 'Acme Corp',
        title: 'Senior Engineer',
        start: '2021',
        end: null,
        current: true,
        groups: [
          {
            id: GROUP_A1,
            title: null,
            items: [
              item('p1-b1', 'Migrated billing', ['S3']),
              item('p1-b2', 'Ran on-call', ['S4']),
              item('u1', 'Wrote the onboarding guide', []),
            ],
          },
          {
            id: GROUP_A2,
            title: 'Mentoring',
            items: [item('p1-b3', 'Mentored two new engineers', ['S6'])],
          },
        ],
      },
      {
        id: POSITION_B,
        factId: 'S7',
        company: 'Globex',
        title: 'Engineer',
        start: '2018',
        end: '2021',
        current: false,
        groups: [
          {
            id: 'p2-g1',
            title: null,
            items: [
              item('p2-b1', 'Built search', ['S8']),
              item('p2-b2', 'Cut search latency by 30%', ['S9']),
            ],
          },
        ],
      },
    ],
    education: [{ id: 'e1', institution: 'Kyiv Polytechnic Institute', start: null, end: null }],
    skills: [],
    additional: [
      {
        id: 'a1',
        title: 'Projects',
        entries: [
          {
            id: ENTRY,
            title: 'Trail app',
            start: null,
            end: null,
            groups: [
              {
                id: 'a1-e1-g1',
                title: null,
                items: [item('a1-e1-i1', 'Offline maps for hikers', ['S10'])],
              },
            ],
          },
        ],
      },
    ],
  };
}

export function answerAnalysis(answers: string[] = []): SourceAnalysis {
  return {
    version: 2,
    locale: 'en',
    notInCv: [],
    coverage: { contentLines: 10, notRecognized: 0, low: false },
    orderReason: null,
    answers,
  };
}

/** One answered question with its queued `apply_answer` job, on the CV above (made once per test). */
export async function answeredCv(
  em: EntityManager,
  user: IUser,
  question: { target: QuestionTarget; answer: Answer; prompt?: string; kind?: QuestionKind },
  edit: (document: CvDocument) => CvDocument = (document) => document,
) {
  const cv = await createCv(em, {
    user,
    targetRole: 'Staff Engineer',
    document: edit(answerDocument()),
    version: 1,
    source: { text: ANSWER_SOURCE, facts: answerAnalysis() },
  });
  const asked = await answerAgain(
    em,
    cv,
    question.target,
    question.answer,
    question.prompt,
    question.kind,
  );
  return { cv, ...asked };
}

export async function answerAgain(
  em: EntityManager,
  cv: Awaited<ReturnType<typeof createCv>>,
  target: QuestionTarget,
  answer: Answer,
  prompt = 'What exactly did you do, and what was the result?',
  kind: QuestionKind = answer.type === 'dates' ? 'missing' : 'vague',
) {
  const question = await createQuestion(em, {
    cv,
    kind,
    target,
    prompt,
    answerType: answer.type,
    status: 'answered',
    answer,
    applyStatus: 'applying',
  });
  const job = await createJob(em, {
    cv,
    kind: 'apply_answer',
    payload: { questionId: question.id, answer },
    target: {
      questionId: question.id,
      section: target.section,
      ...(target.itemId ? { itemId: target.itemId } : {}),
    },
  });
  return { question, job };
}
