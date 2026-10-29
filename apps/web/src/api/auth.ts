import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Credentials, User } from '@cv/shared';
import { api } from './client';
import { ApiError } from './errors';
import { queryKeys } from './keys';
import { forgetUserData } from './query-client';

/** The signed-in user, or `null` when there is no session (the expected 401 is not an error here). */
export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async (): Promise<User | null> => {
      try {
        return await api('me');
      } catch (error) {
        if (error instanceof ApiError && error.code === 'UNAUTHENTICATED') return null;
        throw error;
      }
    },
    staleTime: Infinity,
  });
}

export function useSignIn(mode: 'login' | 'signup') {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (credentials: Credentials) => api(mode, { body: credentials }),
    onSuccess: (user) => {
      forgetUserData(client);
      client.setQueryData(queryKeys.me, user);
    },
  });
}

/**
 * Logging out is two steps the caller orders: the server confirms (or says there was no session), then the
 * caller navigates to `/login` and only after that calls `finishSession`. Clearing the user first would let
 * the route guard send the person to `/login` carrying "come back to this page", which a logout must not.
 * After a failed request the cookie may still be valid, so nothing is cleared.
 */
export function useLogout() {
  return useMutation({
    mutationFn: async () => {
      try {
        await api('logout');
      } catch (error) {
        if (!(error instanceof ApiError && error.code === 'UNAUTHENTICATED')) throw error;
      }
    },
  });
}
