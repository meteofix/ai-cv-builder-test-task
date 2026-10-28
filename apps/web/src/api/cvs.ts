import { useMutation, useQuery, useQueryClient, type Query } from '@tanstack/react-query';
import { ACTIVE_JOB_STATUSES, type CvListResponse, type Job, type JobStep } from '@cv/shared';
import { api } from './client';
import { queryKeys } from './keys';

/** While something is being written the screen asks again every 1.5 s; when nothing is, it does not poll. */
export const POLL_MS = 1500;

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
      for (const key of [queryKeys.cv(id), queryKeys.job(id), queryKeys.draft(id)]) {
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
  });
}

export function useJob(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.job(id),
    queryFn: () => api('getJob', { params: { id } }),
    enabled,
    refetchInterval: (query: Query<Job>) => (isJobActive(query.state.data) ? POLL_MS : false),
  });
}

/** The extractor has finished once the job is past `extract`: from then on the API can build the draft. */
const STEPS_WITH_DRAFT: readonly JobStep[] = ['write', 'judge', 'finalize'];

/** Fetched once and never again: the draft only matters until the finished document replaces it. */
export function useDraft(id: string, job: Job | null | undefined) {
  const ready = job?.step != null && STEPS_WITH_DRAFT.includes(job.step);
  return useQuery({
    queryKey: queryKeys.draft(id),
    queryFn: () => api('getDraft', { params: { id } }),
    enabled: ready,
    staleTime: Infinity,
    select: (data) => data.draft,
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
