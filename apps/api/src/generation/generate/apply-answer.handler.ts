import { EntityManager } from '@mikro-orm/postgresql';
import { Inject, Injectable } from '@nestjs/common';
import { cvDocumentSchema, LIMITS, type NotInCvItem, type QuestionTarget } from '@cv/shared';
import type { Logger } from 'pino';
import { applyAnswerPayloadSchema } from '../../common/generation-queue.js';
import { ROOT_LOGGER } from '../../config/tokens.js';
import { Cv, CvQuestion, CvSource } from '../../db/entities.js';
import { LlmClient } from '../../llm/llm-client.js';
import { Clock } from '../clock.js';
import {
  answerSegments,
  partIndex,
  partOf,
  partRewritten,
  partSettled,
  scopeOf,
} from '../compose/answer-part.js';
import {
  partOutputSchema,
  partRequest,
  partReviewRequest,
  reviewedItems,
} from '../compose/answer.js';
import { prepareSource, sourceAnalysisSchema, type ModelRequest } from '../compose/compose.js';
import { reviewOutputSchema } from '../compose/review.js';
import type { JobHandler, JobRun } from '../job-handler.js';
import { JobError, LeaseLostError } from '../job-errors.js';
import type { ClaimedJob } from '../job-store.js';
import { applyPatch, isDirectField, NOTES, positionNow, type Patch } from './apply-document.js';
import { replaceDocument } from './document-write.js';

/**
 * The `apply_answer` job (docs/specs/generation.md §5): dates and named fields are set without a model; a
 * content answer becomes a segment, the author rewrites only its part (one group of a job's bullets or
 * an entry's lines, or the summary), the reviewer checks the new items, and code applies them. Nothing
 * else in the document changes and no question is created.
 */
@Injectable()
export class ApplyAnswerHandler implements JobHandler {
  private readonly log: Logger;

  constructor(
    @Inject(LlmClient) private readonly llm: LlmClient,
    @Inject(EntityManager) private readonly em: EntityManager,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(ROOT_LOGGER) logger: Logger,
  ) {
    this.log = logger.child({ module: 'generation' });
  }

  /** A text answer may still be a named field; `run` decides that once it has read the question. */
  firstStep(job: ClaimedJob): 'write' | 'finalize' {
    return applyAnswerPayloadSchema.parse(job.payload).answer.type === 'dates'
      ? 'finalize'
      : 'write';
  }

  async run(run: JobRun): Promise<void> {
    const { job } = run;
    const { questionId, answer } = applyAnswerPayloadSchema.parse(job.payload);
    const em = this.em.fork();
    const cv = await em.findOne(Cv, { id: job.cvId, user: job.userId });
    const stored = await em.findOne(CvSource, { cv: job.cvId });
    const question = await em.findOne(CvQuestion, { id: questionId, cv: job.cvId });
    // The CV was deleted (its questions and this job with it): nothing may be written.
    if (!cv || !stored) throw new LeaseLostError();
    // Questions go only with their CV; a job whose question is missing cannot be applied by a retry.
    if (!question) throw new JobError('INTERNAL', undefined, { retryable: false });
    const target = question.target;

    if (answer.type === 'dates') {
      return this.apply(run, questionId, target, { kind: 'dates', answer });
    }
    if (isDirectField(target.field)) {
      const value = answer.text.trim().slice(0, LIMITS.maxFieldChars);
      return this.apply(run, questionId, target, { kind: 'field', field: target.field, value });
    }
    const scope = scopeOf(question.kind);
    const part = cv.document ? partOf(cv.document, target, scope) : null;
    // The answer is the person's statement: it is kept even when its part is gone.
    if (!cv.document || !part) return this.apply(run, questionId, target, null, answer.text);

    // A CV generated before v2 has no stored answers; its answer is the first one.
    const answers = answerSegments([...storedAnswers(stored.facts), answer.text]);
    const content = {
      source: prepareSource(stored.text),
      answers,
      document: cv.document,
      part,
      targetRole: cv.targetRole,
      question: question.prompt,
      context: question.context ?? null,
    };
    const nothing = { kind: 'part' as const, scope, items: [], left: 0 };
    // An answer that reads as an instruction is never shown to a model (it is still kept).
    if (answers.at(-1)?.instruction) {
      return this.apply(run, questionId, target, null, answer.text, NOTES.instruction);
    }
    // Known before any model call: the person's own summary, or no room for anything new.
    if (partSettled(cv.document, part)) {
      return this.apply(run, questionId, target, nothing, answer.text);
    }
    if (job.step === 'write') {
      const output = await this.ask(run, partRequest(content));
      this.log.info({ jobId: job.id, step: 'write', items: output.items.length }, 'answer written');
      // `saveStep` moves the job on; a restarted job resumes at its stored step.
      await run.saveStep('write', output, 'judge');
    }
    const output = partOutputSchema.parse(job.state.write);
    if (job.step === 'judge') {
      const review = await this.ask(run, partReviewRequest({ ...content, output }));
      this.log.info(
        { jobId: job.id, step: 'judge', issues: review.issues.length },
        'answer reviewed',
      );
      await run.saveStep('judge', review, 'finalize');
    }
    const review = reviewOutputSchema.parse(job.state.judge);
    const index = partIndex(content.source, answers);
    const shown = partRewritten(cv.document, part);
    const { items, left } = reviewedItems(output, review, index, part, shown);
    await this.apply(run, questionId, target, { kind: 'part', scope, items, left }, answer.text);
  }

  private ask<T>(run: JobRun, request: ModelRequest<T>): Promise<T> {
    return this.llm.parse({ ...request, job: run.job, signal: run.signal });
  }

  /**
   * One fenced transaction: the document read fresh, only the target changed (version + 1), a content
   * answer kept as a segment for later answers, and the question's outcome. A target that no longer
   * exists changes nothing.
   */
  private async apply(
    run: JobRun,
    questionId: string,
    target: QuestionTarget,
    patch: Patch | null,
    answerText?: string,
    failure?: string,
  ): Promise<void> {
    const { job } = run;
    await run.finish(async (tx) => {
      const cv = await tx.findOne(Cv, { id: job.cvId, user: job.userId }, { refresh: true });
      if (!cv) throw new LeaseLostError();
      const now = this.clock.now();
      const siblings =
        target.position === undefined
          ? []
          : await tx.find(CvQuestion, {
              cv: job.cvId,
              kind: 'unverified',
              id: { $ne: questionId },
            });
      const placed = positionNow(target, siblings);
      const result = cv.document && patch ? applyPatch(cv.document, placed, patch) : null;
      if (result?.kind !== 'patched') {
        const note = failure ?? (result?.kind === 'mismatch' ? NOTES.mismatch : NOTES.gone);
        if (answerText !== undefined) await keepAnswer(tx, job.cvId, answerText, []);
        await outcome(tx, questionId, job.cvId, 'failed', note, now);
        this.log.info({ jobId: job.id, step: 'finalize', applied: 'failed' }, 'answer not applied');
        return;
      }
      if (result.document !== cv.document) {
        await replaceDocument(tx, cv, cvDocumentSchema.parse(result.document), now);
      }
      // The answer is the person's own statement: it is kept even when none of the new text passed.
      if (answerText !== undefined) await keepAnswer(tx, job.cvId, answerText, result.dropped);
      const status = result.partial ? 'partial' : 'applied';
      await outcome(tx, questionId, job.cvId, status, result.note, now);
      this.log.info({ jobId: job.id, step: 'finalize', applied: status }, 'answer applied');
    });
  }
}

function storedAnswers(facts: unknown): string[] {
  const analysis = sourceAnalysisSchema.safeParse(facts);
  return analysis.success ? analysis.data.answers : [];
}

/**
 * Later answers build on this one, so it is stored with the analysis of the generation; earlier items
 * the answer's part no longer shows join "Not in your CV" there.
 */
async function keepAnswer(
  tx: EntityManager,
  cvId: string,
  text: string,
  dropped: readonly NotInCvItem[],
): Promise<void> {
  const stored = await tx.findOne(CvSource, { cv: cvId }, { refresh: true });
  const analysis = sourceAnalysisSchema.safeParse(stored?.facts);
  // A CV generated before v2 has no analysis to add to; its answers are not reused.
  if (!analysis.success) return;
  const { answers, notInCv } = analysis.data;
  const facts = {
    ...analysis.data,
    answers: [...answers, text],
    notInCv: [...notInCv, ...dropped],
  };
  await tx.nativeUpdate(CvSource, { cv: cvId }, { facts });
}

async function outcome(
  tx: EntityManager,
  questionId: string,
  cvId: string,
  applyStatus: 'applied' | 'partial' | 'failed',
  applyNote: string | null,
  now: Date,
): Promise<void> {
  await tx.nativeUpdate(
    CvQuestion,
    { id: questionId, cv: cvId },
    { applyStatus, applyNote, updatedAt: now },
  );
}
