import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { CvDocument, QuestionTarget } from '@cv/shared';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { Cv, CvQuestion, type IUser } from '../src/db/entities.js';
import { JobEngine } from '../src/generation/job-engine.js';
import { entityManager, resetDatabase } from './support/db.js';
import { createQuestion, createUser } from './support/factories.js';
import { answerAgain, answeredCv, GROUP_A1, POSITION_A } from './generation/answer-fixture.js';
import { NO_ISSUES } from './generation/author-answers.js';
import { pipelineHarness } from './generation/pipeline-harness.js';

/*
 * A bullet the review took out comes back to its place (docs/specs/generation.md §5): job A's
 * first group was [Migrated billing, Ran on-call, Wrote the onboarding guide] and the review took out
 * the first two, asking about each at its index.
 */
const harness = pipelineHarness();
const { fake, clock } = harness;
let app: NestFastifyApplication;
let user: IUser;

beforeAll(async () => {
  app = await harness.start();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDatabase(app);
  fake.reset();
  clock.reset();
  user = await createUser(entityManager(app));
});

const at = (position: number): QuestionTarget => ({
  section: 'experience',
  itemId: GROUP_A1,
  position,
});
const reviewed = (document: CvDocument): CvDocument => ({
  ...document,
  experience: document.experience.map((job) =>
    job.id === POSITION_A
      ? {
          ...job,
          groups: job.groups.map((group, g) =>
            g === 0 ? { ...group, items: group.items.slice(2) } : group,
          ),
        }
      : job,
  ),
});
/** A content answer runs three steps: write, judge, finalize; the author writes this one bullet. */
const answerWith = async (text: string) => {
  fake.on('author', { output: { items: [{ text, segments: ['A1'] }] } });
  fake.on('reviewer', { output: NO_ISSUES });
  for (let i = 0; i < 3; i++) await app.get(JobEngine).processNext();
};
const firstGroup = async (cvId: string) =>
  (await entityManager(app).findOneOrFail(Cv, cvId)).document!.experience[0]!.groups[0]!.items.map(
    (item) => item.text,
  );

it('keeps the review order when the second taken-out bullet is answered before the first', async () => {
  const em = entityManager(app);
  const { cv } = await answeredCv(
    em,
    user,
    { target: at(1), answer: { type: 'text', text: 'I ran it weekly.' }, kind: 'unverified' },
    reviewed,
  );
  const first = await createQuestion(em, {
    cv,
    kind: 'unverified',
    target: at(0),
    prompt: 'Did you migrate it?',
    answerType: 'text',
  });

  await answerWith('Ran the weekly on-call rota');
  expect(await firstGroup(cv.id)).toEqual([
    'Ran the weekly on-call rota',
    'Wrote the onboarding guide',
  ]);

  await em.nativeUpdate(CvQuestion, { id: first.id }, { status: 'dismissed' });
  await answerAgain(
    em,
    cv,
    at(0),
    { type: 'text', text: 'I moved billing to the new ledger.' },
    'Did you migrate it?',
    'unverified',
  );
  await answerWith('Migrated billing to the new ledger');
  expect(await firstGroup(cv.id)).toEqual([
    'Migrated billing to the new ledger',
    'Ran the weekly on-call rota',
    'Wrote the onboarding guide',
  ]);
});

it('counts a dismissed earlier bullet as not back: its place stays empty', async () => {
  const em = entityManager(app);
  const { cv } = await answeredCv(
    em,
    user,
    { target: at(1), answer: { type: 'text', text: 'I ran it weekly.' }, kind: 'unverified' },
    reviewed,
  );
  await createQuestion(em, {
    cv,
    kind: 'unverified',
    target: at(0),
    prompt: 'Did you migrate it?',
    answerType: 'text',
    status: 'dismissed',
  });

  await answerWith('Ran the weekly on-call rota');
  expect(await firstGroup(cv.id)).toEqual([
    'Ran the weekly on-call rota',
    'Wrote the onboarding guide',
  ]);
});
