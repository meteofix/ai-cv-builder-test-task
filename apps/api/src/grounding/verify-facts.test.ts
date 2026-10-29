import { describe, expect, it } from 'vitest';
import type { ExtractedFact } from './facts.js';
import { verifyFacts } from './verify-facts.js';

const SOURCE = `Iryna Kovalenko
iryna@example.com
Senior Engineer, Acme Corp, 2021 – present
- Led the billing migration.
Kyiv Polytechnic Institute, BSc Computer Science, 2014 – 2018
TypeScript, React`;

const position: ExtractedFact = {
  id: 'pos',
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
};
const achievement: ExtractedFact = {
  id: 'ach',
  kind: 'achievement',
  quote: 'Led the billing migration.',
  achievement: { positionId: 'pos' },
};

describe('verifyFacts', () => {
  it('renumbers kept facts f1…fn in source order and rewrites position references', () => {
    const { facts } = verifyFacts(SOURCE, [
      { id: 'skill', kind: 'skill', quote: 'TypeScript, React', skill: { name: 'React' } },
      achievement,
      position,
      {
        id: 'name',
        kind: 'contact',
        quote: 'Iryna Kovalenko',
        contact: { field: 'fullName', value: 'Iryna Kovalenko' },
      },
    ]);
    expect(facts.map((fact) => [fact.id, fact.kind])).toEqual([
      ['f1', 'contact'],
      ['f2', 'position'],
      ['f3', 'achievement'],
      ['f4', 'skill'],
    ]);
    expect(facts[2]).toMatchObject({ achievement: { positionId: 'f2' } });
    expect(SOURCE.slice(...facts[1]!.span)).toBe(position.quote);
  });

  it('keeps the first of two facts with the same id', () => {
    const { facts, dropped } = verifyFacts(SOURCE, [position, { ...achievement, id: 'pos' }]);
    expect(facts.map((fact) => fact.kind)).toEqual(['position']);
    expect(dropped).toEqual([{ id: 'pos', kind: 'achievement', reason: 'duplicate_id' }]);
  });

  it('lets a located fact keep an id that an invented fact used first', () => {
    const invented = { ...position, quote: 'Staff Engineer, Google' };
    const { facts, dropped } = verifyFacts(SOURCE, [invented, position]);
    expect(facts.map((fact) => fact.kind)).toEqual(['position']);
    expect(dropped).toEqual([{ id: 'pos', kind: 'position', reason: 'quote_not_found' }]);
  });

  it('keeps an achievement whose position was dropped and no position stands above, without a position', () => {
    const invented = { ...position, quote: 'Staff Engineer, Google' };
    const { facts, dropped, unplaced } = verifyFacts(SOURCE, [invented, achievement]);
    expect(facts).toMatchObject([{ kind: 'achievement', achievement: { positionId: null } }]);
    expect(dropped).toEqual([{ id: 'pos', kind: 'position', reason: 'quote_not_found' }]);
    expect(unplaced).toBe(1);
  });

  it('drops a contact whose value is not in its quote', () => {
    const { dropped } = verifyFacts(SOURCE, [
      {
        id: 'c',
        kind: 'contact',
        quote: 'iryna@example.com',
        contact: { field: 'phone', value: '+380 50 123 4567' },
      },
    ]);
    expect(dropped).toEqual([{ id: 'c', kind: 'contact', reason: 'field_not_in_quote' }]);
  });

  it('clears education values and dates that are not in the quote', () => {
    const { facts } = verifyFacts(SOURCE, [
      {
        id: 'e',
        kind: 'education',
        quote: 'Kyiv Polytechnic Institute, BSc Computer Science, 2014 – 2018',
        education: {
          institution: 'Kyiv Polytechnic Institute',
          degree: 'MSc',
          start: '2014-09',
          end: '2019',
        },
      },
    ]);
    expect(facts[0]).toMatchObject({
      education: {
        institution: 'Kyiv Polytechnic Institute',
        degree: null,
        start: '2014-09',
        end: null,
      },
    });
  });

  it('removes a fact overlapping an instruction span and keeps the others', () => {
    const lineStart = SOURCE.indexOf('- Led');
    const { facts, dropped } = verifyFacts(
      SOURCE,
      [position, achievement],
      [[lineStart, lineStart + 5]],
    );
    expect(facts.map((fact) => fact.kind)).toEqual(['position']);
    expect(dropped).toEqual([{ id: 'ach', kind: 'achievement', reason: 'instruction' }]);
  });

  it.each([
    [
      'a URL',
      'link',
      'https://ab.example.com',
      'Site: https://a-b.example.com',
      'https://a-b.example.com',
    ],
    [
      'an e-mail',
      'email',
      'iryna.k@example.com',
      'Mail: iryna-k@example.com',
      'iryna-k@example.com',
    ],
  ] as const)(
    'stores %s as written in the source, not as the model spelled it',
    (_case, field, value, quote, stored) => {
      const { facts } = verifyFacts(quote, [
        { id: 'c', kind: 'contact', quote, contact: { field, value } },
      ]);
      expect(facts[0]).toMatchObject({ contact: { field, value: stored } });
    },
  );

  it('keeps the model’s spelling of a display value that matches only by letters and digits', () => {
    const quote = 'I R Y N A  K O V A L E N K O, ACME Corp., Node.js';
    const { facts } = verifyFacts(quote, [
      { id: 'n', kind: 'contact', quote, contact: { field: 'fullName', value: 'Iryna Kovalenko' } },
      {
        id: 'p',
        kind: 'position',
        quote,
        position: {
          company: 'Acme Corp',
          title: '',
          location: null,
          start: null,
          end: null,
          current: false,
        },
      },
      { id: 's', kind: 'skill', quote, skill: { name: 'nodejs' } },
    ]);
    expect(
      facts.map((fact) =>
        JSON.stringify(
          fact.kind === 'contact'
            ? fact.contact
            : fact.kind === 'position'
              ? fact.position.company
              : fact.kind === 'skill'
                ? fact.skill
                : null,
        ),
      ),
    ).toEqual([
      JSON.stringify({ field: 'fullName', value: 'Iryna Kovalenko' }),
      JSON.stringify('Acme Corp'),
      JSON.stringify({ name: 'nodejs' }),
    ]);
  });

  it('stores the source’s text for a display value it has exactly', () => {
    const quote = 'Senior Engineer — Platform at Acme';
    const { facts } = verifyFacts(quote, [
      {
        id: 'p',
        kind: 'position',
        quote,
        position: {
          company: 'Acme',
          title: 'Senior Engineer - Platform',
          location: null,
          start: null,
          end: null,
          current: false,
        },
      },
    ]);
    expect(facts[0]).toMatchObject({
      position: { title: 'Senior Engineer — Platform', company: 'Acme' },
    });
  });

  it('trims a model value kept on a letters-and-digits match', () => {
    const quote = 'A C M E';
    const { facts } = verifyFacts(quote, [
      {
        id: 'p',
        kind: 'position',
        quote,
        position: {
          company: ' Acme\n',
          title: '',
          location: null,
          start: null,
          end: null,
          current: false,
        },
      },
    ]);
    expect(facts[0]).toMatchObject({ position: { company: 'Acme' } });
  });

  it('does not find a value whose source text is longer than a field may be', () => {
    const composed = 'é'.repeat(150);
    const quote = `${composed.normalize('NFD')} Ltd`;
    const { facts } = verifyFacts(quote, [
      {
        id: 'p',
        kind: 'position',
        quote,
        position: {
          company: composed,
          title: '',
          location: null,
          start: null,
          end: null,
          current: false,
        },
      },
    ]);
    expect(facts[0]).toMatchObject({ position: { company: '' } });
  });

  it.each([
    [
      'an e-mail that is the end of a longer one',
      'email',
      'k@example.com',
      'Mail: iryna.k@example.com',
    ],
    [
      'an e-mail inside a longer domain',
      'email',
      'iryna@example.com',
      'Mail: iryna@example.com.ua',
    ],
    [
      'a link that is the start of a longer one',
      'link',
      'https://github.com/iryna',
      'Code: https://github.com/iryna-k',
    ],
    ['a phone that is the end of a longer number', 'phone', '123 45 67', 'Tel: +380 50 123 45 67'],
    [
      'a phone whose groups are split by narrow no-break spaces',
      'phone',
      '6 12 34 56 78',
      'Tel: +33\u202f6\u202f12\u202f34\u202f56\u202f78',
    ],
    [
      'a phone written with non-breaking hyphens',
      'phone',
      '123-45-67',
      'Tel: 050\u2011123\u201145\u201167',
    ],
    ['a phone written with en dashes', 'phone', '123-45-67', 'Tel: 050–123–45–67'],
    ['a phone after an area code and a slash', 'phone', '1234567', 'Tel: 0171/1234567'],
    [
      'a link without the port of the real one',
      'link',
      'https://example.com',
      'Site: https://example.com:8443/cv',
    ],
    ['a phone after a spaced en dash', 'phone', '123 45 67', 'Tel: 050 – 123 45 67'],
    ['a phone behind an area code in brackets', 'phone', '123 45 67', 'Tel: +38 (050) 123 45 67'],
  ] as const)('drops %s', (_case, field, value, quote) => {
    const { facts, dropped } = verifyFacts(quote, [
      { id: 'c', kind: 'contact', quote, contact: { field, value } },
    ]);
    expect(facts).toEqual([]);
    expect(dropped).toEqual([{ id: 'c', kind: 'contact', reason: 'field_not_in_quote' }]);
  });

  it.each([
    [
      'followed by a full stop',
      'email',
      'Write to iryna@example.com.',
      'iryna@example.com',
      'iryna@example.com',
    ],
    [
      'in brackets',
      'link',
      'Site (https://iryna.example.org), blog',
      'https://iryna.example.org',
      'https://iryna.example.org',
    ],
    ['in quotes', 'email', 'Mail "iryna@example.com"', 'iryna@example.com', 'iryna@example.com'],
    [
      'glued to its label',
      'email',
      'Email:iryna@example.com',
      'iryna@example.com',
      'iryna@example.com',
    ],
    ['a phone glued to its label', 'phone', 'Tel:+380501234567', '+380501234567', '+380501234567'],
    [
      'a phone with messengers in brackets',
      'phone',
      '+380 50 123 45 67 (Viber, Telegram)',
      '+380501234567',
      '+380 50 123 45 67',
    ],
    [
      'a phone after a note in brackets',
      'phone',
      '(mobile) +380 50 123 45 67',
      '+380501234567',
      '+380 50 123 45 67',
    ],
    [
      'after an icon glyph',
      'email',
      '\ue0beiryna@example.com',
      'iryna@example.com',
      'iryna@example.com',
    ],
    [
      'between bars',
      'email',
      'Kyiv | iryna@example.com | +380',
      'iryna@example.com',
      'iryna@example.com',
    ],
    [
      'a link the model wrote without its scheme',
      'link',
      'https://github.com/iryna-k',
      'github.com/iryna-k',
      'https://github.com/iryna-k',
    ],
    [
      'a link the model wrote without www',
      'link',
      'https://www.linkedin.com/in/x',
      'linkedin.com/in/x',
      'https://www.linkedin.com/in/x',
    ],
    [
      'a link with a final slash in the source',
      'link',
      'Code: https://github.com/iryna-k/ and more',
      'https://github.com/iryna-k',
      'https://github.com/iryna-k/',
    ],
    [
      'a whole occurrence after a partial one',
      'email',
      'iryna.k@example.com, k@example.com',
      'k@example.com',
      'k@example.com',
    ],
    [
      'a link with a final slash before a full stop',
      'link',
      'See https://github.com/iryna-k/.',
      'https://github.com/iryna-k',
      'https://github.com/iryna-k/',
    ],
    [
      'a phone after a postcode and a comma',
      'phone',
      'Kyiv, 01001, +380 50 123 45 67',
      '+380501234567',
      '+380 50 123 45 67',
    ],
    [
      'a phone after a house number',
      'phone',
      'вул. Хрещатик, 22, +380 50 123 45 67',
      '+380501234567',
      '+380 50 123 45 67',
    ],
    [
      'a phone followed by office hours',
      'phone',
      '+380 50 123 45 67 (9:00–18:00)',
      '+380501234567',
      '+380 50 123 45 67',
    ],
    [
      'a phone in brackets',
      'phone',
      'iryna@x.com (+380 50 123 45 67)',
      '+380 50 123 45 67',
      '+380 50 123 45 67',
    ],
    [
      'a phone with its area code in brackets',
      'phone',
      'Tel: (050) 123-45-67',
      '0501234567',
      '(050) 123-45-67',
    ],
  ] as const)('keeps an address %s', (_case, field, quote, value, stored) => {
    const { facts } = verifyFacts(quote, [
      { id: 'c', kind: 'contact', quote, contact: { field, value } },
    ]);
    expect(facts[0]).toMatchObject({ contact: { value: stored } });
  });

  it.each([
    [
      '"current" and a verified end date become a question',
      'Engineer, Acme, 2020 - 2021',
      '2021',
      { end: null, current: false },
    ],
    [
      'a promotion year is not taken for an end date',
      'Engineer, Acme, 2018 – present (promoted 2021)',
      '2021',
      { end: null, current: false },
    ],
    [
      '"current" stays without an end date',
      'Engineer, Acme, 2020 - present',
      null,
      { end: null, current: true },
    ],
    [
      'an end date not in the quote does not cancel "current"',
      'Engineer, Acme, 2020 - present',
      '2023',
      { end: null, current: true },
    ],
  ])('%s', (_case, quote, end, expected) => {
    const { facts } = verifyFacts(quote, [
      {
        id: 'p',
        kind: 'position',
        quote,
        position: {
          company: 'Acme',
          title: 'Engineer',
          location: null,
          start: '2020',
          end,
          current: true,
        },
      },
    ]);
    expect(facts[0]).toMatchObject({ position: expected });
  });

  it.each([
    ['Tel: +380 50 123 45 67', '+380501234567', '+380 50 123 45 67'],
    ['Phone (050) 123-45-67', '0501234567', '(050) 123-45-67'],
  ])('keeps the signs written around a phone number in %j', (quote, value, stored) => {
    const { facts } = verifyFacts(quote, [
      { id: 'c', kind: 'contact', quote, contact: { field: 'phone', value } },
    ]);
    expect(facts[0]).toMatchObject({ contact: { value: stored } });
  });

  it('treats an end year equal to the start year on a current job as ambiguous', () => {
    const quote = 'Engineer, Acme, 2020 – present';
    const { facts } = verifyFacts(quote, [
      {
        id: 'p',
        kind: 'position',
        quote,
        position: {
          company: 'Acme',
          title: 'Engineer',
          location: null,
          start: '2020',
          end: '2020',
          current: true,
        },
      },
    ]);
    expect(facts[0]).toMatchObject({ position: { start: '2020', end: null, current: false } });
  });

  it('stores the quote as the source text, not the model’s copy of it', () => {
    const source = 'Cut   costs by 1,140%.';
    const { facts } = verifyFacts(source, [
      { id: 'r', kind: 'profile', quote: 'cut costs by 1140' },
    ]);
    expect(facts[0]?.quote).toBe('Cut costs by 1,140');
  });

  it.each([
    [
      'a link without its scheme',
      'link',
      'Code: https://github.com/iryna-k',
      'github.com/iryna-k',
      'https://github.com/iryna-k',
    ],
    [
      'a phone without its plus',
      'phone',
      'Tel: +380 50 123 45 67',
      '380 50 123 45 67',
      '+380 50 123 45 67',
    ],
  ] as const)(
    'keeps %s when the quote is only the value, taking what belongs to it from the source',
    (_case, field, source, value, stored) => {
      const { facts } = verifyFacts(source, [
        { id: 'c', kind: 'contact', quote: value, contact: { field, value } },
      ]);
      expect(facts[0]).toMatchObject({ contact: { value: stored } });
    },
  );

  it('keeps the brackets around a phone out of the value when the quote is only the value', () => {
    const source = 'iryna@x.com (+380 50 123 45 67)';
    const value = '+380 50 123 45 67';
    const { facts } = verifyFacts(source, [
      { id: 'c', kind: 'contact', quote: value, contact: { field: 'phone', value } },
    ]);
    expect(facts[0]).toMatchObject({ contact: { value } });
  });

  it('finds a link after a long run of letters quickly, even after partial occurrences', () => {
    // Each rejected occurrence looks back for a scheme; over the whole source that took about a second
    // per occurrence, so the look-back window keeps this well under the bound.
    const partial = ' .github.com/iryna-k'.repeat(4);
    const source = `${'a'.repeat(45_000)}${partial} https://github.com/iryna-k`;
    const started = performance.now();
    const { facts } = verifyFacts(source, [
      {
        id: 'c',
        kind: 'contact',
        quote: source,
        contact: { field: 'link', value: 'github.com/iryna-k' },
      },
    ]);
    expect(facts[0]).toMatchObject({ contact: { value: 'https://github.com/iryna-k' } });
    expect(performance.now() - started).toBeLessThan(1_500);
  });
});
