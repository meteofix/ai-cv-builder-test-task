export const queryKeys = {
  me: ['me'] as const,
  cvs: ['cvs'] as const,
  cv: (id: string) => ['cv', id] as const,
  job: (id: string) => ['cv', id, 'job'] as const,
  draft: (id: string) => ['cv', id, 'draft'] as const,
  notInCv: (id: string) => ['cv', id, 'not-in-cv'] as const,
};
