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
 * The session ends on the client only once the server confirmed it (or said there was none): after a failed
 * request the cookie may still be valid, and showing the login page would suggest otherwise.
 */
export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      try {
        await api('logout');
      } catch (error) {
        if (!(error instanceof ApiError && error.code === 'UNAUTHENTICATED')) throw error;
      }
    },
    onSuccess: () => {
      forgetUserData(client);
      client.setQueryData(queryKeys.me, null);
    },
  });
}
