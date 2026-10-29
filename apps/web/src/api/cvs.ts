import { useMutation, useQuery, useQueryClient, type Query } from '@tanstack/react-query';
import { ACTIVE_JOB_STATUSES, type CvListResponse, type Job } from '@cv/shared';
import { api } from './client';
import { ApiError } from './errors';
import { queryKeys } from './keys';

/** While something is being written the screen asks again every 1.5 s; when nothing is, it does not poll. */
export const POLL_MS = 1500;

/** After this many failures in a row an unreachable API is left alone: the connection banner keeps probing. */
const MAX_REFETCHES_AFTER_ERROR = 20;
const MAX_BACKOFF_MS = 15_000;

/**
 * When to ask again after a failed request: with growing pauses, never for a refusal (a 4xx will not change
 * by asking again: a deleted or foreign CV), and not forever.
 */
function refetchAfterError(state: {
  error: Error | null;
  errorUpdateCount: number;
}): number | false {
  const refusal =
    state.error instanceof ApiError && state.error.status >= 400 && state.error.status < 500;
  if (refusal || state.errorUpdateCount >= MAX_REFETCHES_AFTER_ERROR) return false;
  return Math.min(POLL_MS * 2 ** state.errorUpdateCount, MAX_BACKOFF_MS);
}

export function isJobActive(job: Job | null | undefined): boolean {
  return job != null && ACTIVE_JOB_STATUSES.some((status) => status === job.status);
}

export function useCvList() {
  return useQuery({
    queryKey: queryKeys.cvs,
    queryFn: () => api('listCvs'),
    select: (data) => data.items,
    refetchInterval: (query: Query<CvListResponse>) =>
      query.state.data?.items.some(
        (item) => item.state === 'generating' || item.state === 'updating',
      )
        ? POLL_MS
        : false,
  });
}

export function useDeleteCv() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api('deleteCv', { params: { id } }),
    onSuccess: (_data, id) => {
      for (const key of [queryKeys.cv(id), queryKeys.job(id)]) {
        client.removeQueries({ queryKey: key });
      }
    },
    // Success or not (a 404 means it is already gone), the list must be asked again.
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.cvs }),
  });
}

export type CreateCvInput =
  | { kind: 'text'; targetRole: string; text: string }
  | { kind: 'pdf'; targetRole: string; file: File };

export function useCreateCv() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCvInput) => {
      if (input.kind === 'text') {
        return api('createCvFromText', {
          body: { targetRole: input.targetRole, text: input.text },
        });
      }
      // The role goes first: the API reads multipart fields in order and needs it before the file.
      const form = new FormData();
      form.append('targetRole', input.targetRole);
      form.append('file', input.file);
      return api('createCvFromPdf', { form });
    },
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.cvs }),
  });
}

export function useCv(id: string) {
  return useQuery({
    queryKey: queryKeys.cv(id),
    queryFn: () => api('getCv', { params: { id } }),
    // A failed fetch (typically the one after a job ended) is tried again with growing pauses.
    refetchInterval: (query) =>
      query.state.status === 'error' ? refetchAfterError(query.state) : false,
  });
}

/**
 * `known` is the job the CV already names: polling goes on while it is active even if the first request
 * failed, so one 500 does not stall a generation until the page is reloaded.
 */
export function useJob(id: string, enabled = true, known?: Job | null) {
  return useQuery({
    queryKey: queryKeys.job(id),
    queryFn: () => api('getJob', { params: { id } }),
    enabled,
    refetchInterval: (query: Query<Job>) => {
      // The cache can hold an earlier job of this CV: it counts only when it is the job the CV names.
      const { data } = query.state;
      const current = data && (!known || data.id === known.id) ? data : known;
      if (!isJobActive(current)) return false;
      return query.state.status === 'error' ? refetchAfterError(query.state) : POLL_MS;
    },
  });
}

export function useRetryJob(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api('retryJob', { params: { id } }),
    onSuccess: async (job) => {
      client.setQueryData(queryKeys.job(id), job);
      await client.invalidateQueries({ queryKey: queryKeys.job(id) });
    },
  });
}
