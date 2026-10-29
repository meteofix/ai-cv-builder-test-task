import type { CvDocument } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import { renderCvBody, renderCvHtml } from '../src/index.js';
import { enSample } from './fixtures/en-sample.js';

const FONTS = { fonts: { baseUrl: '/fonts' } };

const first = enSample.experience[0]!;

function withBullets(texts: string[]): CvDocument {
  return {
    ...enSample,
    experience: [
      {
        ...first,
        groups: [
          {
            id: 'g',
            title: null,
            items: texts.map((text, index) => ({ id: `b${index}`, text, factIds: [] })),
          },
        ],
      },
    ],
  };
}

describe('renderCvBody', () => {
  it('renders duplicate bullet texts twice (ids are the keys, not the texts)', () => {
    const html = renderCvBody(withBullets(['Did the thing.', 'Did the thing.']));

    expect(html.match(/<li>Did the thing\.<\/li>/g)).toHaveLength(2);
  });

  it.each([
    ['a lowercase javascript: link', 'javascript:alert(1)'],
    ['a mixed-case JavaScript: link', 'JavaScript:alert(1)'],
    ['a data: link', 'data:text/html,<b>x</b>'],
    ['a vbscript: link', 'vbscript:msgbox(1)'],
  ])('never makes a link of %s', (_name, link) => {
    const body = renderCvBody({
      ...enSample,
      contacts: { ...enSample.contacts, links: [link] },
    });
    const contacts = /<ul class="cv-contacts">(.*?)<\/ul>/.exec(body)?.[1] ?? '';

    expect(contacts).not.toContain('href="' + link);
    expect(contacts.match(/<a /g)).toHaveLength(2); // only the email and the phone
  });

  it('education without a degree uses the institution as the title and has no meta line', () => {
    const body = renderCvBody({
      ...enSample,
      education: [{ id: 'e', institution: 'State University', start: '2010', end: '2014' }],
    });
    const education = /cv-section--education.*?<\/section>/s.exec(body)?.[0] ?? '';

    expect(education).toContain('<h3 class="cv-entry__title">State University</h3>');
    expect(education).not.toContain('cv-entry__meta');
  });

  it('leaves out what has no text: blank skills, bullets, lines, links, entries and sections', () => {
    const blank: CvDocument = {
      ...enSample,
      contacts: { ...enSample.contacts, email: ' ', links: ['', '  '] },
      summary: { text: '   ', factIds: [] },
      experience: [
        {
          id: 'x',
          company: ' ',
          title: '',
          start: null,
          end: null,
          current: false,
          groups: [{ id: 'xg', title: 'Platform', items: [{ id: 'xb', text: ' ', factIds: [] }] }],
        },
      ],
      education: [{ id: 'y', institution: '', degree: ' ', start: null, end: null }],
      skills: [{ id: 'g', title: 'Tools', items: [{ id: 's', name: '  ' }] }],
      additional: [
        {
          id: 'a',
          title: 'Languages',
          entries: [
            {
              id: 'ae',
              title: ' ',
              start: null,
              end: null,
              groups: [
                { id: 'ag', title: 'Spoken', items: [{ id: 'ai', text: ' ', factIds: [] }] },
              ],
            },
          ],
        },
        {
          id: 'b',
          title: '  ',
          entries: [
            {
              id: 'be',
              title: '',
              start: null,
              end: null,
              groups: [
                {
                  id: 'bg',
                  title: null,
                  items: [{ id: 'bi', text: 'Ukrainian — native', factIds: [] }],
                },
              ],
            },
          ],
        },
      ],
    };

    const body = renderCvBody(blank);

    expect(body).not.toContain('cv-section--summary');
    expect(body).not.toContain('cv-section--experience');
    expect(body).not.toContain('cv-section--education');
    expect(body).not.toContain('cv-section--skills');
    expect(body).not.toContain('Languages');
    expect(body).not.toContain('cv-entry');
    expect(body).not.toContain('<li></li>');
    // The contacts keep the phone and the location only, and the section with items but no title has no heading.
    expect(body).not.toContain('mailto:');
    expect(body).not.toContain('<h2');
    expect(body).toContain('Ukrainian — native');
  });
});

describe('renderCvHtml', () => {
  it('escapes the title, which is built from the name and the headline', () => {
    const html = renderCvHtml(
      {
        ...enSample,
        contacts: { ...enSample.contacts, fullName: '</title><script>x</script>' },
        headline: 'A "quoted" & <b>bold</b> headline',
      },
      FONTS,
    );
    const head = html.slice(0, html.indexOf('</head>'));

    expect(html).not.toContain('<script');
    expect(head.match(/<\/title>/g)).toHaveLength(1);
    expect(head).toContain(
      '&lt;/title&gt;&lt;script&gt;x&lt;/script&gt; — A &quot;quoted&quot; &amp; &lt;b&gt;bold&lt;/b&gt; headline',
    );
  });
});
