import type { CvDetail, CvListItem, CvState, Job, Question } from '@cv/shared';
import type { ICv, ICvQuestion, IGenerationJob } from '../db/entities.js';

export function toQuestionDto(question: ICvQuestion): Question {
  return {
    id: question.id,
    kind: question.kind,
    target: question.target,
    prompt: question.prompt,
    context: question.context ?? null,
    answerType: question.answerType,
    status: question.status,
    answer: question.answer ?? null,
    applyStatus: question.applyStatus ?? null,
    applyNote: question.applyNote ?? null,
  };
}

export function toCvDetail(cv: ICv, job: Job | null, questions: ICvQuestion[]): CvDetail {
  return {
    id: cv.id,
    targetRole: cv.targetRole,
    document: cv.document ?? null,
    version: cv.version,
    job,
    questions: questions.map(toQuestionDto),
    createdAt: cv.createdAt.toISOString(),
    updatedAt: cv.updatedAt.toISOString(),
  };
}

/** What the list shows of a CV: derived from the document and the latest job, never stored. */
export function cvState(
  cv: ICv,
  latestJob: Pick<IGenerationJob, 'kind' | 'status'> | undefined,
): CvState {
  const active = latestJob?.status === 'queued' || latestJob?.status === 'running';
  if (latestJob?.kind === 'generate' && active) return 'generating';
  if (latestJob?.kind === 'generate' && latestJob.status === 'failed' && !cv.document)
    return 'failed';
  if (latestJob?.kind === 'apply_answer' && active) return 'updating';
  return cv.document ? 'ready' : 'generating';
}

export function toCvListItem(
  cv: ICv,
  latestJob: Pick<IGenerationJob, 'kind' | 'status'> | undefined,
  openQuestions: number,
): CvListItem {
  const fullName = cv.document?.contacts.fullName.trim() ?? '';
  return {
    id: cv.id,
    targetRole: cv.targetRole,
    fullName: fullName.length > 0 ? fullName : null,
    state: cvState(cv, latestJob),
    openQuestions,
    updatedAt: cv.updatedAt.toISOString(),
  };
}
