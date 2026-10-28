/** Size limits of a CV document; the document schema, the editor and the LLM output schemas share them. */
export const LIMITS = {
  maxExperience: 12,
  maxBulletsPerPosition: 6,
  maxBulletChars: 220,
  maxSummaryChars: 600,
  maxEducation: 6,
  maxSkills: 30,
  maxLinks: 5,
  maxAdditionalSections: 8,
  maxAdditionalItems: 20,
  maxFieldChars: 200,
  maxTextChars: 2000,
} as const;
