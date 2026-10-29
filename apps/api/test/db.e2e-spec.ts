import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MikroORM } from '@mikro-orm/postgresql';
import { Cv, CvQuestion, CvSource, GenerationJob } from '../src/db/entities.js';
import { Migration20261029120000_skill_groups } from '../src/db/migrations/Migration20261029120000_skill_groups.js';
import { Migration20261029140000_item_groups } from '../src/db/migrations/Migration20261029140000_item_groups.js';
import { createTestApp } from './support/create-test-app.js';
import { entityManager, resetDatabase } from './support/db.js';
import { createCv, createJob, createQuestion, createUser } from './support/factories.js';

describe('database schema', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
  });

  it('deletes the source, questions and jobs of a deleted CV (the worker relies on it)', async () => {
    const em = entityManager(app);
    const cv = await createCv(em, { user: await createUser(em) });
    await createQuestion(em, { cv });
    await createJob(em, { cv, status: 'running' });

    await em.nativeDelete(Cv, { id: cv.id });

    const fresh = entityManager(app);
    expect(await fresh.count(CvSource, { cv: cv.id })).toBe(0);
    expect(await fresh.count(CvQuestion, { cv: cv.id })).toBe(0);
    expect(await fresh.count(GenerationJob, { cv: cv.id })).toBe(0);
  });

  it.each([['queued'], ['running']] as const)(
    'refuses a second active job for one CV while one is %s',
    async (status) => {
      const em = entityManager(app);
      const cv = await createCv(em, { user: await createUser(em) });
      await createJob(em, { cv, status });
      await expect(createJob(entityManager(app), { cv, status: 'queued' })).rejects.toThrow(
        /generation_jobs_one_active_per_cv/,
      );
    },
  );

  // The worker merges step results into `state`; a JSON string scalar there would lose them.
  it('stores the state and payload of a job created without them as JSON objects', async () => {
    const em = entityManager(app);
    const job = await createJob(em, { cv: await createCv(em, { user: await createUser(em) }) });

    const [row] = await entityManager(app)
      .getConnection()
      .execute<{ state: string; payload: string }[]>(
        'select jsonb_typeof(state) as state, jsonb_typeof(payload) as payload from generation_jobs where id = ?',
        [job.id],
      );
    expect(row).toEqual({ state: 'object', payload: 'object' });
  });

  it('allows a new job once the previous one has finished', async () => {
    const em = entityManager(app);
    const cv = await createCv(em, { user: await createUser(em) });
    await createJob(em, { cv, status: 'succeeded' });
    await createJob(em, { cv, status: 'failed' });
    await expect(createJob(em, { cv, status: 'queued' })).resolves.toBeDefined();
  });

  describe('the skill-group migration', () => {
    const migration = () => {
      const orm = app.get(MikroORM);
      return new Migration20261029120000_skill_groups(orm.em.getDriver(), orm.config);
    };
    const apply = async (direction: 'up' | 'down') => {
      const em = entityManager(app);
      const step = migration();
      await step[direction]();
      for (const query of step.getQueries()) await em.execute(query);
    };
    const documentWith = async (document: unknown) => {
      const em = entityManager(app);
      const cv = await createCv(em, { user: await createUser(em) });
      await em.execute(`update cvs set document = ?::jsonb where id = ?`, [
        JSON.stringify(document),
        cv.id,
      ]);
      return async () =>
        (
          await entityManager(app).execute<{ document: unknown }[]>(
            `select document from cvs where id = ?`,
            [cv.id],
          )
        )[0]?.document;
    };
    const flat = {
      skills: [
        { id: 'k1', name: 'Go' },
        { id: 'k2', name: 'SQL' },
      ],
    };

    it('moves flat skills into one group without a title, once', async () => {
      const read = await documentWith(flat);
      await apply('up');
      const grouped = { skills: [{ id: 'skills', title: null, items: flat.skills }] };
      expect(await read()).toEqual(grouped);
      await apply('up');
      expect(await read()).toEqual(grouped);
    });

    it.each([
      ['an empty list', { skills: [] }],
      ['no skills field', { headline: 'x' }],
    ])('leaves a document with %s as it is', async (_case, document) => {
      const read = await documentWith(document);
      await apply('up');
      expect(await read()).toEqual(document);
    });

    it('goes back to one flat list in group order', async () => {
      const read = await documentWith({
        skills: [
          {
            id: 'g1',
            title: 'A',
            items: [
              { id: 'k1', name: 'Go' },
              { id: 'k2', name: 'SQL' },
            ],
          },
          { id: 'g2', title: null, items: [{ id: 'k3', name: 'Rust' }] },
        ],
      });
      await apply('down');
      expect(await read()).toEqual({
        skills: [
          { id: 'k1', name: 'Go' },
          { id: 'k2', name: 'SQL' },
          { id: 'k3', name: 'Rust' },
        ],
      });
    });
  });

  describe('the item-group migration', () => {
    const apply = async (direction: 'up' | 'down') => {
      const orm = app.get(MikroORM);
      const em = entityManager(app);
      const step = new Migration20261029140000_item_groups(orm.em.getDriver(), orm.config);
      await step[direction]();
      for (const query of step.getQueries()) await em.execute(query);
    };
    const documentWith = async (document: unknown) => {
      const em = entityManager(app);
      const cv = await createCv(em, { user: await createUser(em) });
      await em.execute(`update cvs set document = ?::jsonb where id = ?`, [
        JSON.stringify(document),
        cv.id,
      ]);
      return async () =>
        (
          await entityManager(app).execute<{ document: unknown }[]>(
            `select document from cvs where id = ?`,
            [cv.id],
          )
        )[0]?.document;
    };
    const bullets = [
      { id: 'b1', text: 'Led billing.', factIds: ['S3'] },
      { id: 'b2', text: 'Ran on-call.', factIds: [] },
    ];
    const lines = [{ id: 'l1', text: 'English — C1', factIds: [] }];

    it('splits a section of more than 20 lines into entries of 20, in order, and back', async () => {
      const many = Array.from({ length: 41 }, (_, i) => ({
        id: `l${i}`,
        text: `${i}`,
        factIds: [],
      }));
      const read = await documentWith({
        experience: [],
        additional: [{ id: 'a1', title: 'Talks', items: many }],
      });
      await apply('up');
      const entry = (k: number, items: typeof many) => ({
        id: `a1-e${k}`,
        title: '',
        start: null,
        end: null,
        groups: [{ id: `a1-g${k}`, title: null, items }],
      });
      expect(await read()).toEqual({
        experience: [],
        additional: [
          {
            id: 'a1',
            title: 'Talks',
            entries: [
              entry(1, many.slice(0, 20)),
              entry(2, many.slice(20, 40)),
              entry(3, many.slice(40)),
            ],
          },
        ],
      });
      await apply('down');
      expect(await read()).toEqual({
        experience: [],
        additional: [{ id: 'a1', title: 'Talks', items: many }],
      });
    });

    it('puts flat bullets and extra lines into one group without a title, once', async () => {
      const read = await documentWith({
        experience: [
          { id: 'p1', title: 'Engineer', bullets },
          { id: 'p2', title: 'Intern', bullets: [] },
        ],
        additional: [{ id: 'a1', title: 'Languages', items: lines }],
      });
      await apply('up');
      const grouped = {
        experience: [
          { id: 'p1', title: 'Engineer', groups: [{ id: 'p1-g1', title: null, items: bullets }] },
          { id: 'p2', title: 'Intern', groups: [] },
        ],
        additional: [
          {
            id: 'a1',
            title: 'Languages',
            entries: [
              {
                id: 'a1-e1',
                title: '',
                start: null,
                end: null,
                groups: [{ id: 'a1-g1', title: null, items: lines }],
              },
            ],
          },
        ],
      };
      expect(await read()).toEqual(grouped);
      await apply('up');
      expect(await read()).toEqual(grouped);
      await apply('down');
      expect(await read()).toEqual({
        experience: [
          { id: 'p1', title: 'Engineer', bullets },
          { id: 'p2', title: 'Intern', bullets: [] },
        ],
        additional: [{ id: 'a1', title: 'Languages', items: lines }],
      });
    });
  });
});
