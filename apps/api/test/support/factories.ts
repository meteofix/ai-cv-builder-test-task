import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CvDocument } from '@cv/shared';
import { hash } from 'argon2';
import {
  Cv,
  CvQuestion,
  CvSource,
  GenerationJob,
  User,
  type ICv,
  type ICvQuestion,
  type IGenerationJob,
  type IUser,
} from '../../src/db/entities.js';

/** Password of every user created by `createUser`, for login tests. */
export const TEST_PASSWORD = 'correct horse battery staple';

let passwordHash: Promise<string> | undefined;

export async function createUser(
  em: EntityManager,
  overrides: Partial<Pick<IUser, 'email'>> = {},
): Promise<IUser> {
  // argon2 is deliberately slow; one hash serves every test user.
  passwordHash ??= hash(TEST_PASSWORD);
  const user = em.create(User, {
    email: overrides.email ?? `user-${randomUUID()}@example.com`,
    passwordHash: await passwordHash,
  });
  await em.flush();
  return user;
}

export interface CvFactoryInput {
  user: IUser;
  targetRole?: string;
  document?: CvDocument | null;
  version?: number;
  source?: { kind?: 'pdf' | 'text'; text?: string; facts?: Record<string, unknown> | null };
}

/** A CV with its source text, as `POST /api/cvs` leaves it before the job runs (unless `document` is given). */
export async function createCv(em: EntityManager, input: CvFactoryInput): Promise<ICv> {
  const cv = em.create(Cv, {
    user: input.user,
    targetRole: input.targetRole ?? 'Senior Full-Stack Engineer',
    document: input.document ?? null,
    version: input.version ?? (input.document ? 1 : 0),
  });
  em.create(CvSource, {
    cv,
    kind: input.source?.kind ?? 'text',
    text: input.source?.text ?? SAMPLE_SOURCE_TEXT,
    facts: input.source?.facts ?? null,
  });
  await em.flush();
  return cv;
}

export async function createJob(
  em: EntityManager,
  input: { cv: ICv } & Partial<
    Pick<
      IGenerationJob,
      'kind' | 'status' | 'step' | 'attempts' | 'payload' | 'target' | 'errorCode' | 'errorMessage'
    >
  >,
): Promise<IGenerationJob> {
  const { cv, ...fields } = input;
  const job = em.create(GenerationJob, { kind: 'generate', ...fields, cv, user: cv.user });
  await em.flush();
  return job;
}

export async function createQuestion(
  em: EntityManager,
  input: { cv: ICv } & Partial<
    Pick<ICvQuestion, 'kind' | 'target' | 'prompt' | 'context' | 'answerType' | 'status'>
  >,
): Promise<ICvQuestion> {
  const { cv, ...fields } = input;
  const question = em.create(CvQuestion, {
    kind: 'missing',
    target: { section: 'experience', itemId: randomUUID(), field: 'dates' },
    prompt: 'When did you work here?',
    answerType: 'dates',
    ...fields,
    cv,
  });
  await em.flush();
  return question;
}

export const SAMPLE_SOURCE_TEXT = `Iryna Kovalenko
iryna@example.com · Kyiv

Experience
Senior Engineer, Acme Corp, 2021 – present
- Led the migration of the billing service to TypeScript.

Education
Kyiv Polytechnic Institute, BSc Computer Science, 2014 – 2018

Skills
TypeScript, PostgreSQL, React`;

/** A valid document for tests that need a finished CV. */
export function sampleDocument(overrides: Partial<CvDocument> = {}): CvDocument {
  return {
    locale: 'en',
    contacts: {
      fullName: 'Iryna Kovalenko',
      email: 'iryna@example.com',
      phone: '',
      location: 'Kyiv',
      links: [],
    },
    headline: 'Senior Full-Stack Engineer',
    summary: { text: 'Full-stack engineer.', factIds: [] },
    experience: [
      {
        id: randomUUID(),
        company: 'Acme Corp',
        title: 'Senior Engineer',
        start: '2021',
        end: null,
        current: true,
        bullets: [
          { id: randomUUID(), text: 'Led the migration of billing to TypeScript.', factIds: [] },
        ],
      },
    ],
    education: [{ id: randomUUID(), institution: 'Kyiv Polytechnic Institute' }],
    skills: [{ id: randomUUID(), name: 'TypeScript' }],
    additional: [],
    ...overrides,
  };
}
