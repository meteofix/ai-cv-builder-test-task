import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { describe, expect, it } from 'vitest';
import { authorOutputSchema } from '../generation/compose/author-schema.js';
import { retryAfterMs, statusError } from './anthropic-transport.js';

describe('retryAfterMs', () => {
  const now = Date.parse('2026-10-29T10:00:00Z');
  it.each([
    ['seconds', '7', 7_000],
    ['fractional seconds', '1.5', 1_500],
    ['an HTTP date', 'Thu, 29 Oct 2026 10:00:12 GMT', 12_000],
    ['an HTTP date in the past', 'Thu, 29 Oct 2026 09:59:00 GMT', null],
    ['zero', '0', null],
    ['blank', ' ', null],
    ['nothing', undefined, null],
    ['garbage', 'soon', null],
  ])('reads %s', (_case, value, expected) => {
    expect(retryAfterMs(value, now)).toBe(expected);
  });
});

describe('statusError', () => {
  it.each([
    [429, 'transient'],
    [500, 'transient'],
    [502, 'transient'],
    [503, 'transient'],
    [504, 'transient'],
    [529, 'transient'],
    [401, 'auth'],
    [403, 'auth'],
    [400, 'rejected'],
    [413, 'rejected'],
    [501, 'rejected'],
  ])('%i → %s', (status, reason) => {
    expect(statusError(status, null).reason).toBe(reason);
  });

  it('keeps retry-after only for a transient status', () => {
    expect(statusError(529, '4').retryAfterMs).toBe(4_000);
    expect(statusError(401, '4').retryAfterMs).toBeNull();
  });
});

describe('zodOutputFormat', () => {
  it("turns the author's output schema into a JSON schema the SDK accepts and parses back", () => {
    const format = zodOutputFormat(authorOutputSchema);
    expect(format.type).toBe('json_schema');
    const answer = {
      locale: 'en',
      contacts: [{ field: 'email', value: 'a@example.com', segment: 'S2' }],
      headline: { text: null, segments: ['S1'] },
      summary: [],
      experience: [
        {
          title: 'Lead',
          company: 'Acme',
          location: '',
          start: '2022',
          end: null,
          current: true,
          segments: ['S3'],
          bullets: [{ text: 'Shipped', segments: ['S4'] }],
        },
      ],
      education: [],
      skills: [],
      additional: [],
      notIncluded: [],
      headings: [],
      gaps: [],
      orderReason: '',
    };
    expect(format.parse(JSON.stringify(answer))).toEqual(answer);
    const noTitle = {
      ...answer,
      experience: [{ ...answer.experience[0], title: undefined }],
    };
    expect(() => format.parse(JSON.stringify(noTitle))).toThrow(
      /Failed to parse structured output/,
    );
  });
});
