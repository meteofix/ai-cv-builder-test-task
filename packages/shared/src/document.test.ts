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
