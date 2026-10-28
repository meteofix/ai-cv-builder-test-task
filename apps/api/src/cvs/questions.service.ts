import { LockMode } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { Inject, Injectable } from '@nestjs/common';
import type { AnswerQuestionRequest, Job, Question } from '@cv/shared';
import { ApiError } from '../common/api-error.js';
import { GenerationQueue } from '../common/generation-queue.js';
import { isUuid, OwnedCvs } from '../common/owned-cvs.js';
import { CvQuestion, type ICvQuestion } from '../db/entities.js';
import { toQuestionDto } from './cv-mapper.js';
import { lockCv } from './lock-cv.js';
import { assertNoNul } from './no-nul.js';

/** Answering and dismissing the questions of a CV. */
@Injectable()
export class QuestionsService {
  constructor(
    @Inject(EntityManager) private readonly em: EntityManager,
    @Inject(OwnedCvs) private readonly owned: OwnedCvs,
    @Inject(GenerationQueue) private readonly queue: GenerationQueue,
  ) {}

  /**
   * Records the answer and queues the job that applies it, in one transaction: if another job is active
   * the queue throws JOB_ACTIVE and the question stays open, so answers are applied one at a time.
   */
  async answer(
    cvId: string,
    questionId: string,
    userId: string,
    { answer }: AnswerQuestionRequest,
  ): Promise<{ question: Question; job: Job }> {
    assertNoNul(answer, 'answer');
    return this.em.fork().transactional(async (tx) => {
      const owned = await this.owned.findOwned(cvId, userId, tx);
      const cv = await lockCv(tx, owned.id, 'read');
      const question = await this.findAnswerable(tx, cv.id, questionId, { retry: true });
      if (answer.type !== question.answerType) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `This question needs an answer of type "${question.answerType}".`,
          [{ path: 'answer.type', message: `Expected "${question.answerType}"` }],
        );
      }
      Object.assign(question, {
        status: 'answered',
        answer,
        applyStatus: 'applying',
        applyNote: null,
      } satisfies Partial<ICvQuestion>);
      await tx.flush();

      const { section, itemId } = question.target;
      const job = await this.queue.enqueue(tx, cv, {
        kind: 'apply_answer',
        target: { questionId: question.id, section, ...(itemId === undefined ? {} : { itemId }) },
        payload: { questionId: question.id, answer },
      });
      return { question: toQuestionDto(question), job };
    });
  }

  /** Dismissing does not touch the document, so it is allowed while a job runs. */
  async dismiss(cvId: string, questionId: string, userId: string): Promise<Question> {
    return this.em.fork().transactional(async (tx) => {
      const owned = await this.owned.findOwned(cvId, userId, tx);
      const cv = await lockCv(tx, owned.id, 'read');
      const question = await this.findAnswerable(tx, cv.id, questionId, { retry: false });
      question.status = 'dismissed';
      await tx.flush();
      return toQuestionDto(question);
    });
  }

  /**
   * The question of this CV that can still be changed: open, or, for an answer only (`retry`), answered
   * with a failed application, whose answer would otherwise be lost. A failed one is not dismissed: a
   * retry of its job would apply the answer the user had given up on. The row lock makes parallel calls
   * take turns, so a dismiss and an answer cannot both succeed, and the loser sees the winner's state.
   */
  private async findAnswerable(
    tx: EntityManager,
    cvId: string,
    questionId: string,
    { retry }: { retry: boolean },
  ): Promise<ICvQuestion> {
    // Looked up by (id, cv) of the owned CV only, so another CV's question looks like a missing one.
    const question = isUuid(questionId)
      ? await tx.findOne(
          CvQuestion,
          { id: questionId, cv: cvId },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
        )
      : null;
    if (!question) throw new ApiError('QUESTION_NOT_FOUND');
    const failedApplication = question.status === 'answered' && question.applyStatus === 'failed';
    if (question.status !== 'open' && !(retry && failedApplication)) {
      throw new ApiError('QUESTION_CLOSED');
    }
    return question;
  }
}
