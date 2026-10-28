import {
  ERROR_STATUS,
  ROUTES,
  type CvDetail,
  type CvListItem,
  type CvDocument,
  type ErrorCode,
  type Job,
  type RouteName,
  type User,
} from '@cv/shared';
import { http, HttpResponse, type HttpHandler, type StrictRequest } from 'msw';
import type { z } from 'zod';

type Route<N extends RouteName> = (typeof ROUTES)[N];
type ResponseOf<N extends RouteName> =
  Route<N> extends { response: infer R extends z.ZodType } ? z.input<R> : undefined;

interface ResolverInfo {
  request: StrictRequest<never>;
  params: Record<string, string>;
  /** The JSON body, already parsed with the route's request schema. */
  body: unknown;
}

type Resolver<N extends RouteName> = (
  info: ResolverInfo,
) => ResponseOf<N> | Response | Promise<ResponseOf<N> | Response>;

/**
 * A mock handler for a route of `@cv/shared`. What the resolver returns is parsed with the route's response
 * schema, so a mock that drifts from the contract fails the test that uses it instead of hiding the drift.
 */
export function mockRoute<N extends RouteName>(name: N, resolver: Resolver<N>): HttpHandler {
  const route: (typeof ROUTES)[RouteName] = ROUTES[name];
  const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete';
  return http[method](`*${route.path}`, async ({ request, params }) => {
    let body: unknown;
    if ('body' in route) {
      // A client that drifts from the request schema fails here, as it would against the real API.
      const parsed = route.body.safeParse(await request.clone().json());
      if (!parsed.success) return problem('VALIDATION_FAILED');
      body = parsed.data;
    }
    const result = await resolver({
      body,
      request: request as StrictRequest<never>,
      params: Object.fromEntries(
        Object.entries(params).map(([key, value]) => [key, String(value)]),
      ),
    });
    if (result instanceof Response) return result;
    if (!('response' in route)) return new HttpResponse(null, { status: route.status });
    return HttpResponse.json(route.response.parse(result), { status: route.status });
  });
}

/** An `application/problem+json` answer with the status the contract gives the code. */
export function problem(code: ErrorCode, extra: { detail?: string; requestId?: string } = {}) {
  return HttpResponse.json(
    {
      type: 'about:blank',
      title: code,
      status: ERROR_STATUS[code],
      code,
      requestId: extra.requestId ?? 'req-test',
      ...(extra.detail ? { detail: extra.detail } : {}),
    },
    { status: ERROR_STATUS[code], headers: { 'content-type': 'application/problem+json' } },
  );
}

/** An error page like the ones nginx produces: HTML, no `code`. */
export function nginxError(status: number) {
  return new HttpResponse(`<html><body><h1>${status}</h1></body></html>`, {
    status,
    headers: { 'content-type': 'text/html' },
  });
}

export const USER: User = {
  id: '6f1c2a9e-2b0d-4c1e-9a53-0d7c2f1b8e11',
  email: 'iryna@example.com',
};

export const CV_ID = '0b5c2d1e-8f3a-4b6c-9d2e-1a7f4c3b5e60';

export function job(overrides: Partial<Job> = {}): Job {
  return {
    id: '3e7a1c52-9b4d-4f08-8a21-6c5d0e9f1b72',
    kind: 'generate',
    status: 'succeeded',
    step: 'finalize',
    ...overrides,
  };
}

export function cvDocument(overrides: Partial<CvDocument> = {}): CvDocument {
  return {
    locale: 'en',
    contacts: {
      fullName: 'Iryna Kovalenko',
      email: 'iryna@example.com',
      phone: '',
      location: 'Kyiv, Ukraine',
      links: [],
    },
    headline: 'Senior Full-Stack Engineer',
    summary: { text: 'Full-stack engineer with 7 years of experience.', factIds: [] },
    experience: [],
    education: [],
    skills: [],
    additional: [],
    ...overrides,
  };
}

export function cvDetail(overrides: Partial<CvDetail> = {}): CvDetail {
  return {
    id: CV_ID,
    targetRole: 'Senior Full-Stack Engineer',
    document: cvDocument(),
    version: 1,
    job: job(),
    questions: [],
    createdAt: '2026-10-29T08:00:00.000Z',
    updatedAt: '2026-10-29T08:00:00.000Z',
    ...overrides,
  };
}

export function cvListItem(overrides: Partial<CvListItem> = {}): CvListItem {
  return {
    id: CV_ID,
    targetRole: 'Senior Full-Stack Engineer',
    fullName: 'Iryna Kovalenko',
    state: 'ready',
    openQuestions: 0,
    updatedAt: '2026-10-29T08:00:00.000Z',
    ...overrides,
  };
}
