import { describe, expect, it } from 'vitest';
import type { ExtractedFact } from './facts.js';
import { verifyFacts } from './verify-facts.js';

// Grounding §2: no cascade. An achievement whose position was not kept goes to the first kept position
// of its group, else to the nearest kept position above it in the source, else to none.
const SOURCE = [
  'Acme Corp',
  'Lead 2022 – 2024',
  'Engineer 2019 – 2022',
  'Shipped the billing service',
  'Globex',
  'Analyst 2016 – 2019',
  'Built the reporting pipeline',
].join('\n');

function job(id: string, quote: string, companyQuote: string): ExtractedFact {
  return {
    id,
    kind: 'position',
    quote,
    position: {
      company: companyQuote,
      companyQuote,
      title: quote.split(' ')[0] ?? '',
      location: null,
      start: null,
      end: null,
      current: false,
    },
  };
}

function bullet(id: string, quote: string, positionId: string): ExtractedFact {
  return { id, kind: 'achievement', quote, achievement: { positionId } };
}

function owners(extracted: ExtractedFact[], source = SOURCE, headings: string[] = []) {
  const { facts, reattached } = verifyFacts(source, extracted, [], headings);
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  return {
    reattached,
    owners: facts.flatMap((fact) =>
      fact.kind === 'achievement'
        ? [`${fact.quote} → ${byId.get(fact.achievement.positionId ?? '')?.quote ?? 'none'}`]
        : [],
    ),
  };
}

describe('achievements of a position that was not kept', () => {
  it('go to the first kept position of the same group', () => {
    expect(
      owners([
        job('lead', 'Lead 2022 – 2025 (misquoted)', 'Acme Corp'),
        job('eng', 'Engineer 2019 – 2022', 'Acme Corp'),
        bullet('b', 'Shipped the billing service', 'lead'),
      ]),
    ).toEqual({ reattached: 1, owners: ['Shipped the billing service → Engineer 2019 – 2022'] });
  });

  it('go to the nearest kept position above them when their group has none left', () => {
    expect(
      owners([
        job('eng', 'Engineer 2019 – 2022', 'Acme Corp'),
        job('analyst', 'Analyst 2016 – 2019 (misquoted)', 'Globex'),
        bullet('b', 'Built the reporting pipeline', 'analyst'),
      ]),
    ).toEqual({ reattached: 1, owners: ['Built the reporting pipeline → Engineer 2019 – 2022'] });
  });

  it('go to the nearest kept position above them when the model named no position', () => {
    expect(
      owners([
        job('lead', 'Lead 2022 – 2024', 'Acme Corp'),
        job('analyst', 'Analyst 2016 – 2019', 'Globex'),
        bullet('b', 'Built the reporting pipeline', 'nowhere'),
        bullet('c', 'Shipped the billing service', 'nowhere'),
      ]),
    ).toEqual({
      reattached: 2,
      owners: [
        'Shipped the billing service → Lead 2022 – 2024',
        'Built the reporting pipeline → Analyst 2016 – 2019',
      ],
    });
  });

  it('stay where they are when their position was kept', () => {
    expect(
      owners([
        job('lead', 'Lead 2022 – 2024', 'Acme Corp'),
        job('analyst', 'Analyst 2016 – 2019', 'Globex'),
        bullet('b', 'Built the reporting pipeline', 'lead'),
      ]),
    ).toEqual({ reattached: 0, owners: ['Built the reporting pipeline → Lead 2022 – 2024'] });
  });

  it('go to their group even when the kept position stands below them', () => {
    // Nearest-above would give none here: only the group says where the bullet belongs.
    const source = [
      'Acme Corp',
      'Lead 2022 – 2024',
      'Shipped the billing service',
      'Engineer 2019 – 2022',
    ].join('\n');
    expect(
      owners(
        [
          job('lead', 'Lead 2022 – 2025 (misquoted)', 'Acme Corp'),
          job('eng', 'Engineer 2019 – 2022', 'Acme Corp'),
          bullet('b', 'Shipped the billing service', 'lead'),
        ],
        source,
      ),
    ).toEqual({ reattached: 1, owners: ['Shipped the billing service → Engineer 2019 – 2022'] });
  });

  it('keep the group of the first fact with an id, as the checks do', () => {
    expect(
      owners([
        job('lead', 'Lead 2022 – 2025 (misquoted)', 'Acme Corp'),
        job('lead', 'Analyst 2016 – 2020 (misquoted)', 'Globex'),
        job('eng', 'Engineer 2019 – 2022', 'Acme Corp'),
        job('an', 'Analyst 2016 – 2019', 'Globex'),
        bullet('b', 'Built the reporting pipeline', 'lead'),
      ]).owners,
    ).toEqual(['Built the reporting pipeline → Engineer 2019 – 2022']);
  });

  it('take the group of the located fact that won the id over an earlier unfound one', () => {
    expect(
      owners([
        job('x', 'Lead 2022 – 2025 (misquoted)', 'Globex'),
        job('x', 'Lead 2022 – 2024', 'Acme Corp'),
        job('gone', 'Engineer 2019 – 2023 (misquoted)', 'Acme Corp'),
        job('an', 'Analyst 2016 – 2019', 'Globex'),
        bullet('b', 'Built the reporting pipeline', 'gone'),
      ]).owners,
      // Read the other way round, the group would have no kept position and the bullet would go to the
      // nearest position above it, Analyst.
    ).toEqual(['Built the reporting pipeline → Lead 2022 – 2024']);
  });

  it('do not cross a section heading to the job above, and stay without a position', () => {
    const source = [
      'Acme Corp',
      'Lead 2022 – 2024',
      'Volunteering',
      'Taught chess at a school',
    ].join('\n');
    expect(
      owners(
        [
          job('lead', 'Lead 2022 – 2024', 'Acme Corp'),
          bullet('b', 'Taught chess at a school', 'nowhere'),
        ],
        source,
        ['Volunteering'],
      ),
    ).toEqual({ reattached: 0, owners: ['Taught chess at a school → none'] });
  });
});
