import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './errors';
import { queryKeys } from './keys';

/**
 * One place for the session expiring mid-use: any request answered with 401 `UNAUTHENTICATED` clears the
 * cached user, which sends the route guard to `/login`. A wrong password is `INVALID_CREDENTIALS`, not this.
 */
export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        endSessionOn(client, error);
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        endSessionOn(client, error);
      },
    }),
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
  return client;
}

/** Drops every cached CV and list: the next account on this browser must not see this one's data. */
export function forgetUserData(client: QueryClient): void {
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.me[0] });
}

/**
 * The client side of a finished session: no cached data, no user. `deliberate` marks a logout the person asked
 * for: the route guard then sends them to a plain `/login`, while an expired session keeps "come back to this
 * page". The mark lives in the cache so that signing in (which clears everything but the user) removes it.
 */
export function finishSession(client: QueryClient, deliberate = false): void {
  forgetUserData(client);
  if (deliberate) client.setQueryData(queryKeys.leftOnPurpose, true);
  client.setQueryData(queryKeys.me, null);
}

export function endSessionOn(client: QueryClient, error: unknown): void {
  if (error instanceof ApiError && error.code === 'UNAUTHENTICATED') finishSession(client);
}
