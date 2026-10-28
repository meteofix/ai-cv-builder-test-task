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

/** Drops every cached CV, draft and list: the next account on this browser must not see this one's data. */
export function forgetUserData(client: QueryClient): void {
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.me[0] });
}

function endSessionOn(client: QueryClient, error: Error): void {
  if (error instanceof ApiError && error.code === 'UNAUTHENTICATED') {
    forgetUserData(client);
    client.setQueryData(queryKeys.me, null);
  }
}
