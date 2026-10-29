import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Answer, CvDetail, Question } from '@cv/shared';
import { api } from './client';
import { ApiError } from './errors';
import { queryKeys } from './keys';

/** Items the generation left out of the CV, grouped by the panel "Not in your CV". */
export function useNotInCv(id: string) {
  return useQuery({
    queryKey: queryKeys.notInCv(id),
    queryFn: () => api('getNotInCv', { params: { id } }),
  });
}

/** The question was closed or a job started elsewhere: what the screen shows is out of date, so ask again. */
function refreshIfClosed(client: QueryClient, cvId: string, error: Error): void {
  if (
    error instanceof ApiError &&
    (error.code === 'QUESTION_CLOSED' || error.code === 'JOB_ACTIVE')
  ) {
    void client.invalidateQueries({ queryKey: queryKeys.cv(cvId) });
  }
}

function replaceQuestion(cv: CvDetail, question: Question): CvDetail {
  return { ...cv, questions: cv.questions.map((q) => (q.id === question.id ? question : q)) };
}

/** Answering queues an `apply_answer` job: the CV shows it at once, so the editor turns read-only without a wait. */
export function useAnswerQuestion(cvId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ question, answer }: { question: Question; answer: Answer }) =>
      api('answerQuestion', { params: { id: cvId, qid: question.id }, body: { answer } }),
    onError: (error) => {
      refreshIfClosed(client, cvId, error);
    },
    onSuccess: ({ question, job }) => {
      client.setQueryData<CvDetail>(queryKeys.cv(cvId), (cv) =>
        cv ? { ...replaceQuestion(cv, question), job } : cv,
      );
      client.setQueryData(queryKeys.job(cvId), job);
    },
  });
}

export function useDismissQuestion(cvId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (question: Question) =>
      api('dismissQuestion', { params: { id: cvId, qid: question.id } }),
    onError: (error) => {
      refreshIfClosed(client, cvId, error);
    },
    onSuccess: ({ question }) => {
      client.setQueryData<CvDetail>(queryKeys.cv(cvId), (cv) =>
        cv ? replaceQuestion(cv, question) : cv,
      );
    },
  });
}
