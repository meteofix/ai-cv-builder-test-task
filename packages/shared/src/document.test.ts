import { describe, expect, it } from 'vitest';
import { cvDocumentSchema, linkSchema } from './index.js';

const emptyDocument = {
  locale: 'en',
  contacts: { fullName: 'Iryna Kovalenko', email: '', phone: '', location: '', links: [] },
  headline: 'Senior Full-Stack Engineer',
  summary: { text: '', factIds: [] },
  experience: [],
  education: [],
  skills: [],
  additional: [],
};

describe('cvDocumentSchema', () => {
  it('accepts a minimal document', () => {
    expect(cvDocumentSchema.safeParse(emptyDocument).success).toBe(true);
  });

  it('rejects an unknown locale', () => {
    expect(cvDocumentSchema.safeParse({ ...emptyDocument, locale: 'de' }).success).toBe(false);
  });

  it.each([
    ['https://github.com/example', true],
    ['mailto:a@example.com', true],
    ['tel:+15550100142', true],
    ['javascript:alert(1)', false],
    ['not a url', false],
  ])('link %s → %s', (value, valid) => {
    expect(linkSchema.safeParse(value).success).toBe(valid);
  });
});

describe('ids and dates inside the document', () => {
  const position = (id: string, bulletIds: string[]) => ({
    id,
    company: 'Acme Corp',
    title: 'Engineer',
    start: '2021',
    end: null,
    current: true,
    bullets: bulletIds.map((bulletId) => ({ id: bulletId, text: 'Did things.', factIds: [] })),
  });

  it.each([
    ['unique ids', [position('p1', ['b1', 'b2']), position('p2', ['b1'])], true],
    ['two positions with one id', [position('p1', []), position('p1', [])], false],
    ['two bullets with one id in a position', [position('p1', ['b1', 'b1'])], false],
  ])('%s → valid: %s', (_case, experience, valid) => {
    const result = cvDocumentSchema.safeParse({ ...emptyDocument, experience });
    expect(result.success).toBe(valid);
  });

  it('reports where the duplicate is', () => {
    const result = cvDocumentSchema.safeParse({
      ...emptyDocument,
      experience: [position('p1', ['b1', 'b1'])],
    });
    expect(result.error?.issues[0]?.path).toEqual(['experience', 0, 'bullets', 1, 'id']);
  });

  it('rejects a current position with an end date', () => {
    const experience = [{ ...position('p1', []), end: '2023' }];
    expect(cvDocumentSchema.safeParse({ ...emptyDocument, experience }).success).toBe(false);
  });
});
