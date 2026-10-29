import type { CvDocument, CvEntry, CvPosition } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import { renderCvBody, renderCvHtml } from '../src/index.js';
import { enSample } from './fixtures/en-sample.js';

const lines = (id: string, title: string | null, texts: string[]) => ({
  id,
  title,
  items: texts.map((text, i) => ({ id: `${id}-${i}`, text, factIds: [] })),
});

const position = (id: string, overrides: Partial<CvPosition> = {}): CvPosition => ({
  id,
  company: 'Quillmark',
  title: `Title ${id}`,
  start: null,
  end: null,
  current: false,
  groups: [],
  ...overrides,
});

const withExperience = (experience: CvPosition[]): CvDocument => ({ ...enSample, experience });

const experience = (html: string) => /cv-section--experience.*?<\/section>/s.exec(html)?.[0] ?? '';

/** The text an ATS reads, in document order. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

describe('groups of bullets in a position (decision 036)', () => {
  it('prints a titled group as a subheading right before its own list, an untitled one as the list alone', () => {
    const body = renderCvBody(
      withExperience([
        position('p', {
          groups: [
            lines('g1', null, ['Ran the weekly release train.']),
            lines('g2', 'Platform & backend', ['Split the ledger service.', 'Cut p95 by 40%.']),
            lines('g3', 'Hiring', ['Interviewed 30 candidates.']),
          ],
        }),
      ]),
    );

    expect(experience(body)).toContain(
      '<ul class="cv-entry__bullets"><li>Ran the weekly release train.</li></ul>' +
        '<h4 class="cv-entry__group-title">Platform &amp; backend</h4>' +
        '<ul class="cv-entry__bullets"><li>Split the ledger service.</li><li>Cut p95 by 40%.</li></ul>' +
        '<h4 class="cv-entry__group-title">Hiring</h4>' +
        '<ul class="cv-entry__bullets"><li>Interviewed 30 candidates.</li></ul>',
    );
  });

  it('leaves out a titled group whose lines are all blank', () => {
    const body = renderCvBody(
      withExperience([
        position('p', {
          groups: [lines('g1', 'Cloud', [' ']), lines('g2', 'Data', ['Moved reports to dbt.'])],
        }),
      ]),
    );

    expect(body).not.toContain('Cloud');
    expect(text(experience(body))).toContain('Data Moved reports to dbt.');
  });

  it('shows the shared titled groups of a company after its last title', () => {
    const body = renderCvBody(
      withExperience([
        position('a', { groups: [lines('g', 'Payments', ['Launched card refunds.'])] }),
        position('b', { groups: [lines('h', null, [])] }),
      ]),
    );

    expect(text(experience(body))).toMatch(/Title a.*Title b Payments Launched card refunds\.$/);
  });
});

describe('the period of a company block', () => {
  const header = (body: string) =>
    /cv-entry--group"[^>]*><p class="cv-entry__meta">(.*?)<\/p>/.exec(body)?.[1] ?? '';

  it.each([
    [
      'earliest start to latest end',
      [
        { start: '2021-04', end: '2023-08', current: false },
        { start: '2019-02', end: '2021-03', current: false },
      ],
      'Feb 2019 – Aug 2023',
    ],
    [
      'Present when a position is current',
      [
        { start: '2022-01', end: null, current: true },
        { start: '2018', end: '2021-12', current: false },
      ],
      '2018 – Present',
    ],
    [
      'the known side when no position has a start',
      [
        { start: null, end: '2020-05', current: false },
        { start: null, end: '2019-01', current: false },
      ],
      'May 2020',
    ],
  ])('prints %s', (_name, dates, printed) => {
    const body = renderCvBody(
      withExperience(dates.map((d, i) => position(`p${i}`, { ...d, location: 'Odesa' }))),
    );

    expect(header(body)).toBe(
      '<span class="cv-entry__org">Quillmark</span><span class="cv-entry__location">Odesa</span>' +
        `<span class="cv-entry__dates cv-entry__dates--company">${printed}</span>`,
    );
    // Each position (all of them dated here) keeps its own dates as before.
    expect(experience(body).match(/<span class="cv-entry__dates">/g)).toHaveLength(dates.length);
  });

  it('prints in the document locale and leaves out a block with no dates at all', () => {
    const uk = renderCvBody({
      ...withExperience([
        position('a', { start: '2023-11', current: true }),
        position('b', { start: '2020-03', end: '2023-10' }),
      ]),
      locale: 'uk',
    });
    const undated = renderCvBody(withExperience([position('a'), position('b')]));

    expect(header(uk)).toContain('бер 2020 – дотепер');
    expect(experience(undated)).not.toContain('cv-entry__dates');
  });

  it('gives a single position no company period', () => {
    const body = renderCvBody(withExperience([position('a', { start: '2020', end: '2022' })]));

    expect(body).not.toContain('cv-entry__dates--company');
  });
});

describe('entries of an additional section', () => {
  const entry = (overrides: Partial<CvEntry>): CvEntry => ({
    id: 'e',
    title: '',
    start: null,
    end: null,
    groups: [],
    ...overrides,
  });
  const extra = (entries: CvEntry[]) =>
    /cv-section--extra.*?<\/section>/s.exec(
      renderCvBody({ ...enSample, additional: [{ id: 's', title: 'Projects', entries }] }),
    )?.[0] ?? '';

  it('renders a title with its dates like a position, then its groups of lines', () => {
    const html = extra([
      entry({
        title: 'Tidewater — open-source tide tables',
        start: '2021-06',
        end: '2022',
        groups: [
          lines('g1', null, ['Parsed 40 years of gauge data.']),
          lines('g2', 'Stack', ['Rust and WebAssembly.']),
        ],
      }),
    ]);

    expect(html).toContain(
      '<article class="cv-entry"><div class="cv-entry__head">' +
        '<h3 class="cv-entry__title">Tidewater — open-source tide tables</h3>' +
        '<span class="cv-entry__dates">Jun 2021 – 2022</span></div>' +
        '<ul class="cv-entry__bullets"><li>Parsed 40 years of gauge data.</li></ul>' +
        '<h4 class="cv-entry__group-title">Stack</h4>' +
        '<ul class="cv-entry__bullets"><li>Rust and WebAssembly.</li></ul></article>',
    );
  });

  it('renders a title-only entry (a course) as a compact entry without a list', () => {
    const html = extra([entry({ title: 'Distributed Systems Course', start: '2020-09' })]);

    expect(html).toContain(
      '<article class="cv-entry cv-entry--compact"><div class="cv-entry__head">' +
        '<h3 class="cv-entry__title">Distributed Systems Course</h3>' +
        '<span class="cv-entry__dates">Sep 2020</span></div></article>',
    );
    expect(html).not.toContain('<ul');
  });

  it('renders an entry with lines only as the plain list of the reference', () => {
    const html = extra([entry({ groups: [lines('g', null, ['Speaker at a local meetup'])] })]);

    expect(html).toContain('<ul class="cv-list"><li>Speaker at a local meetup</li></ul>');
    expect(html).not.toContain('cv-entry');
  });
});

describe('summary paragraphs', () => {
  it('keeps the line breaks between paragraphs and the CSS shows them', () => {
    const summary = 'Backend engineer.\nLed two migrations.\n\nOpen to relocation.';
    const html = renderCvHtml(
      { ...enSample, summary: { text: summary, factIds: [] } },
      { fonts: { baseUrl: '/fonts' } },
    );

    expect(html).toContain(`<p class="cv-summary">${summary}</p>`);
    expect(html).toMatch(/\.cv-summary\{[^}]*white-space:pre-line/);
  });
});
