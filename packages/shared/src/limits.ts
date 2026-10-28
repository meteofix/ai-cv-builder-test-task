/** Size limits shared by the document schema, the request schemas, the editor and the LLM output schemas. */
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

  maxEmailChars: 254,
  minPasswordChars: 8,
  // argon2 hashes any length, but an unbounded password is a cheap way to burn server CPU.
  maxPasswordChars: 128,
  maxTargetRoleChars: 200,
  /** Pasted text and text extracted from a PDF; a long CV is about 15 000 characters. */
  maxSourceChars: 50_000,
  maxPdfBytes: 10 * 1024 * 1024,
  maxPdfPages: 10,
  maxAnswerChars: 1000,
} as const;
