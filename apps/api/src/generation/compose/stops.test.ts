import { LIMITS, type CvDocument } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import { alignStops } from './stops.js';

/** A document whose first position holds `texts` as bullets in two groups. */
function withBullets(texts: string[]): CvDocument {
  const items = texts.map((text, i) => ({ id: `p1-b${i + 1}`, text, factIds: ['S1'] }));
  return {
    locale: 'en',
    contacts: { fullName: 'Olena Hrytsenko', email: '', phone: '', location: '', links: [] },
    headline: 'Backend Engineer',
    summary: { text: 'Backend engineer.', factIds: [] },
    experience: [
      {
        id: 'p1',
        company: 'Pinecrest Analytics',
        title: 'Backend Engineer',
        start: '2021',
        end: null,
        current: true,
        groups: [
          { id: 'p1-g1', title: 'Delivery', items: items.slice(0, 2) },
          { id: 'p1-g2', title: null, items: items.slice(2) },
        ],
      },
    ],
    education: [],
    skills: [],
    additional: [],
  };
}

const bullets = (document: CvDocument) =>
  document.experience.flatMap((position) =>
    position.groups.flatMap((group) => group.items.map((item) => item.text)),
  );

describe('alignStops — one ending style for the bullets of a CV', () => {
  it.each([
    [
      'most bullets end bare: the stops go',
      ['Cut builds to 3 minutes.', 'Mentored two developers', 'Ran on-call (12 people)'],
      ['Cut builds to 3 minutes', 'Mentored two developers', 'Ran on-call (12 people)'],
    ],
    [
      'most bullets end with a stop: the bare ones get one',
      ['Cut builds to 3 minutes.', 'Mentored two developers.', 'Raised uptime to 99.9%'],
      ['Cut builds to 3 minutes.', 'Mentored two developers.', 'Raised uptime to 99.9%.'],
    ],
    [
      'a tie goes bare',
      ['Cut builds to 3 minutes.', 'Mentored two developers'],
      ['Cut builds to 3 minutes', 'Mentored two developers'],
    ],
    [
      'an ellipsis, a question or a colon is left as it is',
      ['Shipped v2...', 'Why it failed?', 'Stack:', 'Mentored two developers.', 'Ran on-call.'],
      ['Shipped v2...', 'Why it failed?', 'Stack:', 'Mentored two developers.', 'Ran on-call.'],
    ],
  ])('%s', (_case, texts, expected) => {
    expect(bullets(alignStops(withBullets(texts)))).toEqual(expected);
  });

  it('adds no stop that would take a bullet over its limit', () => {
    const full = 'x'.repeat(LIMITS.maxBulletChars);
    const texts = ['One.', 'Two.', full];
    expect(bullets(alignStops(withBullets(texts)))).toEqual(texts);
  });

  it('keeps everything but the bullets texts as it was', () => {
    const document = withBullets(['One.', 'Two']);
    const aligned = alignStops(document);
    expect({ ...aligned, experience: [] }).toEqual({ ...document, experience: [] });
    expect(aligned.experience[0]?.groups[0]?.items[0]).toEqual({
      id: 'p1-b1',
      text: 'One',
      factIds: ['S1'],
    });
  });
});
