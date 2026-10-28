import { ROUTES, routePath, type RouteName } from '@cv/shared';
import type { z } from 'zod';
import { setApiReachable } from './connection';
import { ApiError, readApiError } from './errors';

type Route<N extends RouteName> = (typeof ROUTES)[N];
type BodyOf<N extends RouteName> =
  Route<N> extends { body: infer B extends z.ZodType } ? z.input<B> : undefined;
type ResponseOf<N extends RouteName> =
  Route<N> extends { response: infer R extends z.ZodType } ? z.output<R> : undefined;

export interface CallOptions<N extends RouteName> {
  params?: Record<string, string>;
  body?: BodyOf<N>;
  /** The multipart body of `createCvFromPdf`. */
  form?: FormData;
  signal?: AbortSignal;
}

/** `fetch` rejects with a TypeError when the request got no answer (offline, DNS, connection reset). */
async function send(url: URL, init: RequestInit): Promise<Response> {
  try {
    const response = await fetch(url, init);
    // nginx answers 502/503/504 with HTML when the API is down; the API's own 503 is problem+json.
    const fromNginx =
      [502, 503, 504].includes(response.status) &&
      !response.headers.get('content-type')?.includes('application/problem+json');
    setApiReachable(!fromNginx);
    return response;
  } catch (error) {
    if (init.signal?.aborted) throw error;
    setApiReachable(false);
    throw new ApiError(0, 'OFFLINE');
  }
}

type RequestOptions = Omit<CallOptions<RouteName>, 'body'> & { body?: unknown };

function buildRequest(route: (typeof ROUTES)[RouteName], options: RequestOptions) {
  // An absolute URL: `fetch` outside a browser (the tests) cannot resolve a relative one.
  const url = new URL(routePath(route.path, options.params), window.location.origin);
  const init: RequestInit = {
    method: route.method,
    credentials: 'same-origin',
    signal: options.signal ?? null,
  };
  if (options.form) {
    init.body = options.form;
  } else if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
    init.headers = { 'content-type': 'application/json' };
  }
  return { url, init };
}

/**
 * Calls a route of `@cv/shared`: the body type and the response type come from the route's schemas, and the
 * response is parsed with the route's schema, so a server that drifts from the contract fails loudly here.
 */
export async function api<N extends RouteName>(
  name: N,
  options: CallOptions<N> = {},
): Promise<ResponseOf<N>> {
  const route: (typeof ROUTES)[RouteName] = ROUTES[name];
  const { url, init } = buildRequest(route, options);
  const response = await send(url, init);
  if (!response.ok) throw await readApiError(response);
  if (!('response' in route)) return undefined as ResponseOf<N>;
  // A 200 that is not JSON is a proxy or SPA fallback page: the API did not answer.
  const data: unknown = await response.json().catch(() => {
    throw new ApiError(response.status, 'UNAVAILABLE');
  });
  return route.response.parse(data) as ResponseOf<N>;
}

/** The PDF is binary, so it does not go through `api`; its errors are `problem+json` like all others. */
export async function downloadPdf(
  id: string,
  signal?: AbortSignal,
): Promise<{ blob: Blob; fileName: string }> {
  const { url, init } = buildRequest(ROUTES.downloadPdf, { params: { id }, signal });
  const response = await send(url, init);
  if (!response.ok) throw await readApiError(response);
  const disposition = response.headers.get('content-disposition') ?? '';
  const fileName = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? 'cv.pdf';
  return { blob: await response.blob(), fileName };
}
