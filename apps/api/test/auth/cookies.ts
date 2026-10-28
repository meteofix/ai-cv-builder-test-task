import type { LightMyRequestResponse } from 'fastify';

/** The whole `Set-Cookie` line of the session cookie, with its attributes. */
export function setCookieOf(res: LightMyRequestResponse): string {
  const header = res.headers['set-cookie'];
  const line = (Array.isArray(header) ? header : [header]).find((cookie) =>
    cookie?.startsWith('sid='),
  );
  if (!line) throw new Error('no sid cookie in the response');
  return line;
}

/** `sid=<token>` from the response, ready to send back as a `Cookie` header. */
export function sidCookie(res: LightMyRequestResponse): string {
  return setCookieOf(res).split(';')[0]!;
}
