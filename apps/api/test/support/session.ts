import type { EntityManager } from '@mikro-orm/postgresql';
import {
  hashSessionToken,
  newSessionToken,
  SESSION_COOKIE,
} from '../../src/common/session-token.js';
import { Session, type IUser } from '../../src/db/entities.js';
import { createUser } from './factories.js';

export interface TestSession {
  user: IUser;
  /** Cookie plus the Fetch Metadata header a browser sends on a same-origin request; without it CSRF answers 403. */
  headers: { cookie: string; 'sec-fetch-site': 'same-origin' };
}

/**
 * Signs a user in without the auth endpoints: writes a session row the way login does and returns the
 * headers for `inject()`. Creates a user when none is given.
 */
export async function signIn(
  em: EntityManager,
  user?: IUser,
  options: { expiresAt?: Date } = {},
): Promise<TestSession> {
  const owner = user ?? (await createUser(em));
  const token = newSessionToken();
  em.create(Session, {
    user: owner,
    tokenHash: hashSessionToken(token),
    expiresAt: options.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  await em.flush();
  return { user: owner, headers: sessionHeaders(token) };
}

export function sessionHeaders(token: string): TestSession['headers'] {
  return { cookie: `${SESSION_COOKIE}=${token}`, 'sec-fetch-site': 'same-origin' };
}
