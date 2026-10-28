import type { CvDocument } from '@cv/shared';
import { describe, expect, it } from 'vitest';
import { renderCvBody, renderCvHtml } from '../src/index.js';

const cv: CvDocument = {
  locale: 'en',
  contacts: { fullName: 'Iryna Kovalenko', email: '', phone: '', location: '', links: [] },
  headline: 'Engineer',
  summary: { text: '', factIds: [] },
  experience: [
    {
      id: 'p1',
      company: 'Acme Corp',
      title: 'Engineer',
      start: '2021',
      end: null,
      current: true,
      bullets: [{ id: 'b1', text: "Saved $$ on hosting: a $& b $` c $' d", factIds: [] }],
    },
  ],
  education: [],
  skills: [],
  additional: [],
};

describe('renderCvHtml', () => {
  it('keeps $ sequences of the CV text as they are, like the preview body', () => {
    const html = renderCvHtml(cv, { fonts: { baseUrl: '/fonts' } });
    expect(html).toContain('Saved $$ on hosting: a $&amp; b $` c $&#x27; d');
    expect(html).toContain(`<body>${renderCvBody(cv)}</body>`);
    expect(html.match(/<head>/g)).toHaveLength(1);
  });
});
