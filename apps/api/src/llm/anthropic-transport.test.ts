import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { describe, expect, it } from 'vitest';
import { authorOutputSchema } from '../generation/compose/author-schema.js';
import { reviewOutputSchema } from '../generation/compose/review.js';
import { retryAfterMs, statusError, toolSchema } from './anthropic-transport.js';

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

describe('toolSchema', () => {
  it("is the author's whole schema as plain JSON Schema: one object, no grammar features", () => {
    const schema = toolSchema(authorOutputSchema);
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties ?? {})).toEqual(Object.keys(authorOutputSchema.shape));
  });
});

describe('zodOutputFormat', () => {
  it("turns the reviewer's output schema into a JSON schema the SDK accepts and parses back", () => {
    const format = zodOutputFormat(reviewOutputSchema);
    expect(format.type).toBe('json_schema');
    const answer = {
      issues: [
        {
          item: 'job.1.2',
          action: 'fix',
          class: 'inflated_scope',
          text: 'Helped ship it',
          segments: ['S4'],
          question: null,
        },
      ],
    };
    expect(format.parse(JSON.stringify(answer))).toEqual(answer);
    const noItem = { issues: [{ ...answer.issues[0], item: undefined }] };
    expect(() => format.parse(JSON.stringify(noItem))).toThrow(/Failed to parse structured output/);
  });
});
