import type { CvDocument, CvPosition } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import { measureFullRun } from './full-metrics.js';
import type { FullRun } from './full-run.js';

const position = (id: string, factIds: string[][]): CvPosition => ({
  id,
  factId: id,
  company: 'Acme',
  title: 'Engineer',
  start: '2020',
  end: '2021',
  current: false,
  bullets: factIds.map((ids, i) => ({ id: `${id}-${i}`, text: 'Did it.', factIds: ids })),
});

const document = (experience: CvPosition[]): CvDocument => ({
  locale: 'en',
  contacts: { fullName: 'A', email: '', phone: '', location: '', links: [] },
  headline: 'Engineer',
  summary: { text: '', factIds: [] },
  experience,
  education: [],
  skills: [{ id: 's1', name: 'Go', factId: 's1' }],
  additional: [],
});

function run(overrides: Partial<FullRun> & { document: CvDocument | null }): FullRun {
  return {
    steps: {},
    totalMs: 0,
    draft: null,
    notInCv: [],
    ...overrides,
    detail: {
      id: '00000000-0000-4000-8000-000000000000',
      targetRole: 'Engineer',
      document: overrides.document,
      version: 1,
      job: null,
      questions: [],
      createdAt: '2026-10-29T00:00:00.000Z',
      updatedAt: '2026-10-29T00:00:00.000Z',
    },
  };
}

describe('measureFullRun', () => {
  const finished = document([
    position('p1', [
      ['a1', 'a2'],
      ['p1', 'a1'],
    ]),
    position('p2', []),
  ]);

  it('counts cited achievements once and adds the unused ones', () => {
    const metrics = measureFullRun(
      run({
        document: finished,
        notInCv: [
          { text: 'Ran the build.', reason: 'unused', context: 'Engineer — Acme' },
          { text: 'Go', reason: 'unused' },
          { text: 'Page 1', reason: 'not_recognized' },
        ],
      }),
      null,
    );
    expect(metrics).toMatchObject({
      bullets: 3,
      notRecognized: 1,
      sourceOrder: null,
      skills: null,
    });
  });

  it('compares the document order with the draft order', () => {
    const draft = document([position('p1', []), position('p2', [])]);
    expect(measureFullRun(run({ document: finished, draft }), null).sourceOrder).toBe(true);
    const reversed = document([position('p2', []), position('p1', [])]);
    expect(measureFullRun(run({ document: reversed, draft }), null).sourceOrder).toBe(false);
  });
});
