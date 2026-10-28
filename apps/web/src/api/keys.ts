/**
 * Flat keys on purpose: `['cv', id]` is a prefix of nothing else, so invalidating a CV never refetches its job
 * or draft ("the draft is fetched exactly once" depends on it).
 */
export const queryKeys = {
  me: ['me'] as const,
  cvs: ['cvs'] as const,
  cv: (id: string) => ['cv', id] as const,
  job: (id: string) => ['cv-job', id] as const,
  draft: (id: string) => ['cv-draft', id] as const,
  notInCv: (id: string) => ['cv-not-in-cv', id] as const,
};
