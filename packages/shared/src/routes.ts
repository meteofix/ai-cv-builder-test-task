import { z } from 'zod';
import { credentialsSchema, userSchema } from './auth.js';
import {
  createCvFromTextRequestSchema,
  createCvResponseSchema,
  cvDetailSchema,
  cvListResponseSchema,
  updateDocumentRequestSchema,
  updateDocumentResponseSchema,
} from './cvs.js';
import { draftResponseSchema, notInCvResponseSchema } from './generation.js';
import { jobSchema } from './jobs.js';
import { answerQuestionRequestSchema, questionSchema } from './questions.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface ApiRoute {
  method: HttpMethod;
  /** Fastify-style pattern with `:param` segments, including the `/api` prefix. */
  path: string;
  /** Status of a successful response. */
  status: number;
  /** JSON body; absent for routes without a body and for the multipart upload. */
  body?: z.ZodType;
  /** JSON response; absent for 204 and for the PDF download. */
  response?: z.ZodType;
  /** `multipart/form-data` instead of JSON. */
  multipart?: true;
}

function route<const R extends ApiRoute>(definition: R): R {
  return definition;
}

/**
 * Every endpoint of the API. The web client and its mock server are typed from this table, and an API test
 * fails when a registered route is missing from it, so the contract and the server cannot drift apart.
 */
export const ROUTES = {
  signup: route({
    method: 'POST',
    path: '/api/auth/signup',
    status: 201,
    body: credentialsSchema,
    response: userSchema,
  }),
  login: route({
    method: 'POST',
    path: '/api/auth/login',
    status: 200,
    body: credentialsSchema,
    response: userSchema,
  }),
  logout: route({ method: 'POST', path: '/api/auth/logout', status: 204 }),
  me: route({ method: 'GET', path: '/api/auth/me', status: 200, response: userSchema }),

  listCvs: route({ method: 'GET', path: '/api/cvs', status: 200, response: cvListResponseSchema }),
  createCvFromText: route({
    method: 'POST',
    path: '/api/cvs',
    status: 202,
    body: createCvFromTextRequestSchema,
    response: createCvResponseSchema,
  }),
  createCvFromPdf: route({
    method: 'POST',
    path: '/api/cvs/from-pdf',
    status: 202,
    multipart: true,
    response: createCvResponseSchema,
  }),
  getCv: route({ method: 'GET', path: '/api/cvs/:id', status: 200, response: cvDetailSchema }),
  updateDocument: route({
    method: 'PUT',
    path: '/api/cvs/:id/document',
    status: 200,
    body: updateDocumentRequestSchema,
    response: updateDocumentResponseSchema,
  }),
  deleteCv: route({ method: 'DELETE', path: '/api/cvs/:id', status: 204 }),
  downloadPdf: route({ method: 'GET', path: '/api/cvs/:id/pdf', status: 200 }),

  getJob: route({ method: 'GET', path: '/api/cvs/:id/job', status: 200, response: jobSchema }),
  retryJob: route({
    method: 'POST',
    path: '/api/cvs/:id/job/retry',
    status: 202,
    response: jobSchema,
  }),
  getDraft: route({
    method: 'GET',
    path: '/api/cvs/:id/draft',
    status: 200,
    response: draftResponseSchema,
  }),
  getNotInCv: route({
    method: 'GET',
    path: '/api/cvs/:id/not-in-cv',
    status: 200,
    response: notInCvResponseSchema,
  }),

  answerQuestion: route({
    method: 'POST',
    path: '/api/cvs/:id/questions/:qid/answer',
    status: 202,
    body: answerQuestionRequestSchema,
    response: z.object({ question: questionSchema, job: jobSchema }),
  }),
  dismissQuestion: route({
    method: 'POST',
    path: '/api/cvs/:id/questions/:qid/dismiss',
    status: 200,
    response: z.object({ question: questionSchema }),
  }),
} as const satisfies Record<string, ApiRoute>;

export type RouteName = keyof typeof ROUTES;

/** Fills `:param` segments: `routePath(ROUTES.getCv.path, { id })` → `/api/cvs/<id>`. */
export function routePath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:(\w+)/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`Missing route parameter "${name}" for ${path}`);
    return encodeURIComponent(value);
  });
}
