import type { CvDocument } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import { renderCvBody, renderCvHtml } from '../src/index.js';
import { enSample } from './fixtures/en-sample.js';
import { ukSample } from './fixtures/uk-sample.js';

const FONTS = { fonts: { baseUrl: '/fonts' } };

function sectionClasses(html: string): string[] {
  return [...html.matchAll(/class="cv-section (cv-section--[a-z]+)"/g)].map(
    (match) => match[1] ?? '',
  );
}

function titles(html: string): string[] {
  return [...html.matchAll(/<h2 class="cv-section__title">(.*?)<\/h2>/g)].map(
    (match) => match[1] ?? '',
  );
}

function dates(html: string): string[] {
  return [...html.matchAll(/<span class="cv-entry__dates">(.*?)<\/span>/g)].map(
    (match) => match[1] ?? '',
  );
}

/** A document with one position, for the date table. */
function withPosition(
  locale: 'en' | 'uk',
  start: string | null,
  end: string | null,
  current: boolean,
): CvDocument {
  return {
    ...enSample,
    locale,
    education: [],
    experience: [{ id: 'p', company: 'Acme', title: 'Engineer', start, end, current, groups: [] }],
  };
}

describe('CV template', () => {
  it('TPL-1 — the en reference: sections, titles and dates', () => {
    const body = renderCvBody(enSample);

    expect(sectionClasses(body)).toEqual([
      'cv-section--summary',
      'cv-section--experience',
      'cv-section--education',
      'cv-section--skills',
      'cv-section--extra',
      'cv-section--extra',
      'cv-section--extra',
    ]);
    expect(titles(body)).toEqual([
      'Summary',
      'Experience',
      'Education',
      'Skills',
      'Certifications',
      'Languages',
      'Volunteering',
    ]);
    const printed = dates(body);
    expect(printed[0]).toBe('Mar 2023 – Present');
    expect(printed[1]).toBe('Jan 2021 – Feb 2023');
    // The position without dates has no dates element: the next dates belong to the education entries.
    expect(printed).toContain('2017 – 2019');
    // Seven dated entries since the reference shows a company with two positions (a company block with two positions).
    expect(printed).toHaveLength(7);
  });

  it('TPL-2 — the uk reference: page, title, section titles and dates', () => {
    const html = renderCvHtml(ukSample, FONTS);

    expect(html.startsWith('<!DOCTYPE html><html lang="uk">')).toBe(true);
    expect(html).toContain('<title>Олег Савчук — Frontend-розробник</title>');
    expect(titles(html)).toEqual(['Про мене', 'Досвід роботи', 'Освіта', 'Навички']);
    expect(dates(html)[0]).toBe('вер 2022 – дотепер');
  });

  it('TPL-3 — empty elements are not rendered', () => {
    const bare: CvDocument = {
      locale: 'en',
      contacts: {
        fullName: 'Iryna Kovalenko',
        email: 'iryna@example.com',
        phone: '',
        location: '',
        links: [],
      },
      headline: '',
      summary: { text: '', factIds: [] },
      experience: [
        {
          id: 'p',
          company: 'Acme',
          title: 'Engineer',
          start: null,
          end: null,
          current: false,
          groups: [],
        },
      ],
      education: [],
      skills: [],
      additional: [],
    };

    const body = renderCvBody(bare);

    for (const absent of [
      'cv-headline',
      '<li></li>',
      'cv-entry__dates',
      'cv-entry__location',
      'cv-entry__bullets',
      'cv-section--skills',
      'cv-section--summary',
      '–',
    ]) {
      expect(body).not.toContain(absent);
    }
    expect(body).toContain('Acme');
  });

  it.each([
    ['en', '2020-05', null, true, 'May 2020 – Present'],
    ['en', '2019', '2021-02', false, '2019 – Feb 2021'],
    ['en', '2018-07', null, false, 'Jul 2018'],
    ['uk', '2023-11', '2024-01', false, 'лист 2023 – січ 2024'],
    ['uk', '2022-09', null, true, 'вер 2022 – дотепер'],
  ] as const)(
    'TPL-4 — dates (%s: %s, %s, current %s) print as "%s"',
    (locale, start, end, current, printed) => {
      expect(dates(renderCvBody(withPosition(locale, start, end, current)))).toEqual([printed]);
    },
  );

  it('TPL-5 — contacts and links', () => {
    const body = renderCvBody({
      ...enSample,
      contacts: {
        fullName: 'Iryna Kovalenko',
        email: 'iryna@example.com',
        phone: '+1 (555) 010-0142',
        location: 'Kyiv, Ukraine',
        links: ['https://github.com/ikovalenko/', 'https://www.linkedin.com/in/iryna'],
      },
    });

    const list = /<ul class="cv-contacts">(.*?)<\/ul>/.exec(body)?.[1];
    expect(list).toBe(
      [
        '<li><a href="mailto:iryna@example.com">iryna@example.com</a></li>',
        '<li><a href="tel:+15550100142">+1 (555) 010-0142</a></li>',
        '<li>Kyiv, Ukraine</li>',
        '<li><a href="https://github.com/ikovalenko/">github.com/ikovalenko</a></li>',
        '<li><a href="https://www.linkedin.com/in/iryna">www.linkedin.com/in/iryna</a></li>',
      ].join(''),
    );
  });

  it('TPL-7 — text is text', () => {
    const doc = withPosition('en', '2020', null, false);
    const first = doc.experience[0];
    if (!first) throw new Error('fixture');
    const hostile: CvDocument = {
      ...doc,
      experience: [
        {
          ...first,
          groups: [
            {
              id: 'g',
              title: null,
              items: [{ id: 'b', text: '<script>alert(1)</script>', factIds: [] }],
            },
          ],
        },
      ],
    };

    expect(renderCvBody(hostile)).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(renderCvHtml(hostile, FONTS)).not.toContain('<script');
  });

  it('TPL-8 — the page is the shell plus the body, with one head', () => {
    const tricky: CvDocument = {
      ...enSample,
      experience: [
        {
          id: 'p',
          company: 'Acme',
          title: 'Engineer',
          start: null,
          end: null,
          current: false,
          groups: [
            {
              id: 'g',
              title: null,
              items: [{ id: 'b', text: "Saved $$ on hosting: a $& b $` c $' d", factIds: [] }],
            },
          ],
        },
      ],
    };

    const html = renderCvHtml(tricky, FONTS);

    // Built by concatenation: a replace call would expand the `$` sequences itself.
    expect(html).toContain('<body>' + renderCvBody(tricky) + '</body>');
    expect(html.match(/<head>/g)).toHaveLength(1);
  });

  it('TPL-9 — consecutive positions at one company', () => {
    const job = (id: string, title: string, start: string, end: string, texts: string[]) => ({
      id,
      company: 'Acme Corp',
      title,
      start,
      end,
      current: false,
      groups: [
        {
          id: `${id}-g`,
          title: null,
          items: texts.map((text, i) => ({ id: `${id}-${i}`, text, factIds: [] })),
        },
      ],
    });
    const globex = {
      ...job('c', 'Developer', '2017-01', '2019-02', ['Built the shop.']),
      company: 'Globex',
    };
    const shared = renderCvBody({
      ...enSample,
      experience: [
        job('a', 'Lead Engineer', '2022-01', '2024-06', ['Shipped the billing service.']),
        job('b', 'Engineer', '2019-03', '2021-12', []),
        globex,
      ],
    });
    const group =
      /<article class="cv-entry cv-entry--group" data-continued="Acme Corp — continued">(.*?)<\/article>/.exec(
        shared,
      )?.[1] ?? '';
    expect(group.match(/cv-entry__org/g)).toHaveLength(1);
    expect(group).toMatch(
      /Acme Corp.*Lead Engineer.*Jan 2022 – Jun 2024.*Engineer.*Mar 2019 – Dec 2021.*<\/div><\/div><ul class="cv-entry__bullets"><li>Shipped the billing service\.<\/li><\/ul>$/,
    );
    expect(shared).toContain(
      '<article class="cv-entry" data-continued="Globex — continued"><div class="cv-entry__head"><h3 class="cv-entry__title">Developer</h3>',
    );
    // When another position of the block has bullets, each position shows its own.
    const own = renderCvBody({
      ...enSample,
      experience: [
        job('a', 'Lead Engineer', '2022-01', '2024-06', ['Led the team.']),
        job('b', 'Engineer', '2019-03', '2021-12', ['Wrote the API.']),
        globex,
      ],
    });
    // The company line carries a location only when every position gives that same one.
    const located = (places: (string | undefined)[]) =>
      renderCvBody({
        ...enSample,
        experience: places.map((location, i) => ({
          ...job(`l${i}`, `Title ${i}`, '2020-01', '2021-01', []),
          ...(location ? { location } : {}),
        })),
      });
    const companyLine = (html: string) =>
      /cv-entry--group"[^>]*><p class="cv-entry__meta">(.*?)<\/p>/.exec(html)?.[1] ?? '';
    expect(companyLine(located(['Kyiv', 'Kyiv']))).toContain('Kyiv');
    expect(companyLine(located(['Kyiv', undefined]))).not.toContain('Kyiv');
    expect(located(['Kyiv', 'Lviv'])).toMatch(/Title 0.*Kyiv.*Title 1.*Lviv/);
    expect(own).toMatch(
      /Lead Engineer.*Led the team\..*<\/div><div class="cv-entry__role">.*Engineer.*Wrote the API\./,
    );
  });

  it('TPL-10 — skill groups', () => {
    const en = renderCvBody(enSample);
    const groups = [...en.matchAll(/<div class="cv-skill-group">(.*?)<\/div>/g)].map((match) =>
      (match[1] ?? '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
    expect(groups).toEqual([
      'Languages: TypeScript JavaScript',
      'Frontend: React Next.js',
      'Backend: Node.js NestJS PostgreSQL Redis',
      'Tooling: Docker Playwright Vitest AWS GitHub Actions Figma',
    ]);
    const uk = renderCvBody(ukSample);
    expect(uk).not.toContain('cv-skill-group');
    expect(uk.match(/class="cv-skills"/g)).toHaveLength(1);
  });
});
