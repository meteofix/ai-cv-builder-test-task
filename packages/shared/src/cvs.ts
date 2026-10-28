import { z } from 'zod';
import { cvDocumentSchema } from './document.js';
import { jobSchema } from './jobs.js';
import { LIMITS } from './limits.js';
import { questionSchema } from './questions.js';

export const targetRoleSchema = z.string().trim().min(1).max(LIMITS.maxTargetRoleChars);

export const createCvFromTextRequestSchema = z.object({
  targetRole: targetRoleSchema,
  text: z.string().trim().min(1).max(LIMITS.maxSourceChars),
});
export type CreateCvFromTextRequest = z.infer<typeof createCvFromTextRequestSchema>;

/** The text fields of the multipart `POST /api/cvs/from-pdf`; the PDF itself is the `file` part. */
export const createCvFromPdfFieldsSchema = z.object({ targetRole: targetRoleSchema });

export const createCvResponseSchema = z.object({ cvId: z.uuid(), job: jobSchema });
export type CreateCvResponse = z.infer<typeof createCvResponseSchema>;

/**
 * State of a CV for the list, derived from the document and the latest job: `generating` while the first
 * generation runs, `failed` when it failed, `updating` while an answer is applied, otherwise `ready`.
 */
export const CV_STATES = ['generating', 'failed', 'updating', 'ready'] as const;
export const cvStateSchema = z.enum(CV_STATES);
export type CvState = z.infer<typeof cvStateSchema>;

export const cvListItemSchema = z.object({
  id: z.uuid(),
  targetRole: z.string(),
  fullName: z.string().nullable(),
  state: cvStateSchema,
  openQuestions: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type CvListItem = z.infer<typeof cvListItemSchema>;

export const cvListResponseSchema = z.object({ items: z.array(cvListItemSchema) });
export type CvListResponse = z.infer<typeof cvListResponseSchema>;

/** No `draft` and no `notInCv`: the generation module serves them on their own routes. */
export const cvDetailSchema = z.object({
  id: z.uuid(),
  targetRole: z.string(),
  document: cvDocumentSchema.nullable(),
  version: z.number().int().nonnegative(),
  job: jobSchema.nullable(),
  questions: z.array(questionSchema),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type CvDetail = z.infer<typeof cvDetailSchema>;

/** The whole document with the version it was based on; a stale version is 409 VERSION_CONFLICT. */
export const updateDocumentRequestSchema = z.object({
  document: cvDocumentSchema,
  version: z.number().int().nonnegative(),
});
export type UpdateDocumentRequest = z.infer<typeof updateDocumentRequestSchema>;

export const updateDocumentResponseSchema = z.object({
  document: cvDocumentSchema,
  version: z.number().int().positive(),
});
export type UpdateDocumentResponse = z.infer<typeof updateDocumentResponseSchema>;
