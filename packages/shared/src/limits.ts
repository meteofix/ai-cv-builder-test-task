/**
 * Size limits shared by the document schema, the request schemas, the editor and the LLM output schemas.
 * The document limits are a safeguard that real CVs do not reach (decision 035): a model answer over them
 * is asked again, never cut.
 */
export const LIMITS = {
  maxExperience: 30,
  maxBulletsPerPosition: 20,
  maxBulletChars: 400,
  maxSummaryChars: 1000,
  maxEducation: 6,
  maxSkills: 120,
  maxSkillGroups: 20,
  /** Groups in one list: the bullets of a position, the lines of an extra entry. */
  maxGroupsPerList: 10,
  maxLinks: 5,
  maxAdditionalSections: 20,
  maxAdditionalItems: 40,
  /** Lines of one extra entry, across its groups (as bullets of a position). */
  maxLinesPerEntry: 20,
  maxFieldChars: 200,
  /** Segments one item of the document may cite. */
  maxFactIds: 60,
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
