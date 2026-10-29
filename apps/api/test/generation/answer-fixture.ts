import type { EntityManager } from '@mikro-orm/postgresql';
import type { Answer, CvDocument, QuestionTarget } from '@cv/shared';
import type { IUser } from '../../src/db/entities.js';
import { buildSkeleton } from '../../src/generation/generate/skeleton.js';
import type { SourceFacts } from '../../src/generation/generate/schemas.js';
import { verifyFacts, type ExtractedFact } from '../../src/grounding/index.js';
import type { TransportRequest } from '../../src/llm/llm-transport.js';
import { createCv, createJob, createQuestion } from '../support/factories.js';

/**
 * A finished CV for the `apply_answer` examples (GEN-20..GEN-22): position A (Acme, `f2`) with AI bullets
 * `a1`, `a2` and the user-written `u1`; position B (Globex, `f5`) with `b1`, `b2`; a summary.
 */
export const ANSWER_SOURCE = `Iryna Kovalenko
Senior Engineer, Acme Corp, 2021 – present
- Led the billing migration.
- Ran the on-call rotation.
Engineer, Globex, 2018 – 2021
- Built the search service.
- Cut search latency by 30%.`;

const EXTRACTED: ExtractedFact[] = [
  {
    id: 'name',
    kind: 'contact',
    quote: 'Iryna Kovalenko',
    contact: { field: 'fullName', value: 'Iryna Kovalenko' },
  },
  {
    id: 'acme',
    kind: 'position',
    quote: 'Senior Engineer, Acme Corp, 2021 – present',
    position: {
      company: 'Acme Corp',
      title: 'Senior Engineer',
      location: null,
      start: '2021',
      end: null,
      current: true,
    },
  },
  {
    id: 'billing',
    kind: 'achievement',
    quote: 'Led the billing migration.',
    achievement: { positionId: 'acme' },
  },
  {
    id: 'oncall',
    kind: 'achievement',
    quote: 'Ran the on-call rotation.',
    achievement: { positionId: 'acme' },
  },
  {
    id: 'globex',
    kind: 'position',
    quote: 'Engineer, Globex, 2018 – 2021',
    position: {
      company: 'Globex',
      title: 'Engineer',
      location: null,
      start: '2018',
      end: '2021',
      current: false,
    },
  },
  {
    id: 'search',
    kind: 'achievement',
    quote: 'Built the search service.',
    achievement: { positionId: 'globex' },
  },
  {
    id: 'latency',
    kind: 'achievement',
    quote: 'Cut search latency by 30%.',
    achievement: { positionId: 'globex' },
  },
];

const VERIFIED = verifyFacts(ANSWER_SOURCE, EXTRACTED).facts;
const idOf = (quote: string): string => {
  const fact = VERIFIED.find((candidate) => candidate.quote === quote);
  if (!fact) throw new Error(`fixture fact not found: ${quote}`);
  return fact.id;
};
export const POSITION_A = idOf('Senior Engineer, Acme Corp, 2021 – present');
export const POSITION_B = idOf('Engineer, Globex, 2018 – 2021');

export async function answeredCv(
  em: EntityManager,
  user: IUser,
  question: { target: QuestionTarget; answer: Answer },
  edit: (document: CvDocument) => CvDocument = (document) => document,
) {
  const facts = VERIFIED;
  const sourceFacts: SourceFacts = {
    locale: 'en',
    facts,
    sectionHeadings: [],
    instructionSpans: [],
    uncoveredLines: [],
    answers: [],
  };
  const bullet = (id: string, text: string, factIds: string[]) => ({ id, text, factIds });
  const document = buildSkeleton({
    source: ANSWER_SOURCE,
    facts,
    targetRole: 'Staff Engineer',
    locale: 'en',
    prose: {
      summary: [{ id: 's1', text: 'Engineer who leads migrations.', factIds: [POSITION_A] }],
      bullets: new Map([
        [
          POSITION_A,
          [
            bullet('a1', 'Led the migration of billing.', [idOf('Led the billing migration.')]),
            bullet('a2', 'Ran on-call.', [idOf('Ran the on-call rotation.')]),
            bullet('u1', 'Wrote the onboarding guide.', []),
          ],
        ],
        [
          POSITION_B,
          [
            bullet('b1', 'Built search.', [idOf('Built the search service.')]),
            bullet('b2', 'Cut search latency by 30%.', [idOf('Cut search latency by 30%.')]),
          ],
        ],
      ]),
      order: [POSITION_A, POSITION_B],
      skills: [],
    },
  });
  const cv = await createCv(em, {
    user,
    targetRole: 'Staff Engineer',
    document: edit(document),
    version: 1,
    source: { text: ANSWER_SOURCE, facts: sourceFacts },
  });
  const row = await createQuestion(em, {
    cv,
    kind: question.answer.type === 'dates' ? 'missing' : 'vague',
    target: question.target,
    answerType: question.answer.type,
    status: 'answered',
    answer: question.answer,
    applyStatus: 'applying',
  });
  const job = await createJob(em, {
    cv,
    kind: 'apply_answer',
    payload: { questionId: row.id, answer: question.answer },
    target: {
      questionId: row.id,
      section: question.target.section,
      ...(question.target.itemId ? { itemId: question.target.itemId } : {}),
    },
  });
  return { cv, question: row, job };
}

/** The facts the writer was given, read back from its request. */
export function writerFacts(request: TransportRequest<unknown>): { id: string; quote: string }[] {
  const input = request.messages[0]?.content ?? '';
  const json = /<cv_source>\n([\s\S]*)\n<\/cv_source>/.exec(input)?.[1] ?? '{"facts":[]}';
  return (JSON.parse(json) as { facts: { id: string; quote: string }[] }).facts;
}

/** One more answered question with its queued job, on a CV made by `answeredCv`. */
export async function answerAgain(
  em: EntityManager,
  cv: Awaited<ReturnType<typeof answeredCv>>['cv'],
  target: QuestionTarget,
  answer: Answer,
) {
  const question = await createQuestion(em, {
    cv,
    kind: 'vague',
    target,
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
