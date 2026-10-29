import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { describe, expect, it } from 'vitest';
import { extractorOutputSchema } from '../generation/generate/schemas.js';
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
  it('turns the extractor output schema into a JSON schema the SDK accepts', () => {
    const format = zodOutputFormat(extractorOutputSchema);
    expect(format.type).toBe('json_schema');
    const answer = {
      locale: 'en',
      experience: [
        {
          company: 'Acme',
          companyQuote: 'Acme',
          positions: [
            {
              quote: 'Lead 2022',
              title: 'Lead',
              location: null,
              start: '2022',
              end: null,
              current: true,
            },
          ],
          bullets: [
            { quote: 'Shipped', position: null },
            { quote: 'Led', position: 0 },
          ],
        },
      ],
      facts: [{ kind: 'profile', quote: 'Calm' }],
      sectionHeadings: [],
      ignoredInstructions: [],
    };
    expect(format.parse(JSON.stringify(answer))).toEqual(answer);
    const noTitle = {
      ...answer,
      experience: [{ ...answer.experience[0], positions: [{ quote: 'x' }] }],
    };
    expect(() => format.parse(JSON.stringify(noTitle))).toThrow(
      /Failed to parse structured output/,
    );
  });
});
