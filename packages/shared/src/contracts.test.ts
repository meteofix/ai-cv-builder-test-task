import { describe, expect, it } from 'vitest';
import {
  answerSchema,
  credentialsSchema,
  ERROR_CODES,
  ERROR_STATUS,
  ROUTES,
  routePath,
} from './index.js';

describe('ROUTES', () => {
  it('has one entry per method and path', () => {
    const keys = Object.values(ROUTES).map((route) => `${route.method} ${route.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('fills and encodes path parameters', () => {
    expect(routePath(ROUTES.answerQuestion.path, { id: 'a', qid: 'b/c' })).toBe(
      '/api/cvs/a/questions/b%2Fc/answer',
    );
  });

  it('refuses a missing parameter instead of producing /api/cvs/undefined', () => {
    expect(() => routePath(ROUTES.getCv.path)).toThrow(/id/);
  });
});

describe('error codes', () => {
  it('gives every code an HTTP status', () => {
    expect(Object.keys(ERROR_STATUS).sort()).toEqual([...ERROR_CODES].sort());
  });
});

describe('credentialsSchema', () => {
  it('normalizes the email so case variants are one account', () => {
    const parsed = credentialsSchema.parse({
      email: '  Iryna@Example.COM ',
      password: 'longenough',
    });
    expect(parsed.email).toBe('iryna@example.com');
  });

  it.each([
    ['not-an-email', 'longenough'],
    ['a@example.com', 'short'],
    ['a@example.com', 'x'.repeat(129)],
  ])('rejects %s / %s', (email, password) => {
    expect(credentialsSchema.safeParse({ email, password }).success).toBe(false);
  });
});

describe('answerSchema', () => {
  it.each([
    [{ type: 'dates', start: '2020-03', end: null, current: true }, true],
    [{ type: 'dates', start: '2020', end: '2022-11', current: false }, true],
    [{ type: 'dates', start: '2020', end: '2022', current: true }, false],
    [{ type: 'dates', start: 'March 2020', end: null, current: true }, false],
    [{ type: 'text', text: 'Led a team of five.' }, true],
    [{ type: 'text', text: '   ' }, false],
  ])('%j → %s', (answer, valid) => {
    expect(answerSchema.safeParse(answer).success).toBe(valid);
  });
});
