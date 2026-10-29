import { randomUUID } from 'node:crypto';
import { EntityManager } from '@mikro-orm/postgresql';
import { Inject, Injectable } from '@nestjs/common';
import { cvDocumentSchema, LIMITS, type QuestionTarget } from '@cv/shared';
import type { Logger } from 'pino';
import { applyAnswerPayloadSchema } from '../../common/generation-queue.js';
import { ROOT_LOGGER } from '../../config/tokens.js';
import { Cv, CvQuestion, CvSource, type ICv } from '../../db/entities.js';
import type { Fact } from '../../grounding/index.js';
import { LlmClient } from '../../llm/llm-client.js';
import { Clock } from '../clock.js';
import type { JobHandler, JobRun } from '../job-handler.js';
import { JobError, LeaseLostError } from '../job-errors.js';
import type { ClaimedJob } from '../job-store.js';
import { applyPatch, isDirectField, NOTES, type Patch } from './apply-document.js';
import { replaceDocument } from './document-write.js';
import { judgeProse } from './judge-step.js';
import { APPLY_BULLETS_SYSTEM, APPLY_SUMMARY_SYSTEM, writerInput } from './prompts.js';
import { proseChecker, quotesOf } from './prose-checks.js';
import {
  applyWriteResultSchema,
  bulletsRewriteSchema,
  judgeResultSchema,
  summaryRewriteSchema,
  withAnswers,
  type ProseItem,
  type SourceFacts,
} from './schemas.js';
import { loadSource, requiredFacts } from './source-facts.js';

/** What a regenerated answer brings to finalize besides the patch. */
interface Regenerated {
  answerFact: Fact;
  partial: boolean;
}

/**
 * The `apply_answer` job (docs/specs/generation.md §5): dates and named fields are set without the LLM; a
 * content answer becomes a fact, and only the AI-written bullets of its position (or the summary) are
 * regenerated and checked again. Nothing else in the document changes and no question is created.
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
    const source = await loadSource(em, job.cvId);
    const question = await em.findOne(CvQuestion, { id: questionId, cv: job.cvId });
    // The CV was deleted (its questions and this job with it): nothing may be written.
    if (!cv || !source) throw new LeaseLostError();
    // Questions go only with their CV; a job whose question is missing cannot be applied by a retry.
    if (!question) throw new JobError('INTERNAL', undefined, { retryable: false });
    const target = question.target;

    if (answer.type === 'dates')
      return this.apply(run, questionId, target, { kind: 'dates', answer });
    if (isDirectField(target.field)) {
      const value = answer.text.trim().slice(0, LIMITS.maxFieldChars);
      return this.apply(run, questionId, target, { kind: 'field', field: target.field, value });
    }
    const facts = requiredFacts(source.facts);
    if (job.step === 'write') {
      const regenerates = targetExists(cv, target);
      if (!regenerates) return this.apply(run, questionId, target, null);
      await this.write(run, cv, source.text, facts, target, answer.text);
    }
    if (job.step === 'judge') await this.judge(run, cv, source.text, facts, target);
    if (job.step === 'finalize') await this.finalizeContent(run, questionId, target);
  }

  private async write(
    run: JobRun,
    cv: ICv,
    text: string,
    facts: SourceFacts,
    target: QuestionTarget,
    answerText: string,
  ): Promise<void> {
    const positionId = positionOf(target);
    // The answer is verified against itself: its span points at the answer appended after the source.
    const start = withAnswers(text, facts.answers).length + 1;
    const base = {
      id: `answer-${run.job.id}`,
      quote: answerText,
      span: [start, start + answerText.length] as const,
    };
    const answerFact: Fact = positionId
      ? { ...base, kind: 'achievement', achievement: { positionId } }
      : { ...base, kind: 'profile' };
    const all = [...facts.facts, ...facts.answers, answerFact];
    // The writer sees only the target's facts: its position and that position's achievements.
    const scope = positionId
      ? all.filter(
          (fact) =>
            fact.id === positionId ||
            (fact.kind === 'achievement' && fact.achievement.positionId === positionId),
        )
      : all;
    const input = writerInput({ facts: scope, targetRole: cv.targetRole, locale: facts.locale });
    const written: ProseItem[] = positionId
      ? (
          await this.llm.parse({
            role: 'writer',
            system: APPLY_BULLETS_SYSTEM,
            input,
            schema: bulletsRewriteSchema,
            job: run.job,
            signal: run.signal,
          })
        ).bullets.map((bullet) => ({ id: randomUUID(), ...bullet }))
      : (
          await this.llm.parse({
            role: 'writer',
            system: APPLY_SUMMARY_SYSTEM,
            input,
            schema: summaryRewriteSchema,
            job: run.job,
            signal: run.signal,
          })
        ).summary.map((sentence, i) => ({ id: `s${i + 1}`, ...sentence }));

    const checker = proseChecker(all, withAnswers(text, [...facts.answers, answerFact]));
    const items = written.filter((item) => checker.passes(item, positionId));
    this.log.info(
      {
        jobId: run.job.id,
        step: 'write',
        written: written.length,
        removed: checker.removed.length,
      },
      'answer prose checked',
    );
    await run.saveStep('write', { answerFact, items, removed: checker.removed }, 'judge');
  }

  private async judge(
    run: JobRun,
    cv: ICv,
    text: string,
    facts: SourceFacts,
    target: QuestionTarget,
  ): Promise<void> {
    const written = applyWriteResultSchema.parse(run.job.state.write);
    const quotes = quotesOf(
      [...facts.facts, ...facts.answers, written.answerFact],
      withAnswers(text, [...facts.answers, written.answerFact]),
    );
    const positionId = positionOf(target);
    const items = written.items.map((item) => ({
      id: item.id,
      text: item.text,
      quotes: quotes(item.factIds),
      positionId,
    }));
    const removed = await judgeProse(this.llm, run, items, cv.targetRole);
    this.log.info(
      { jobId: run.job.id, step: 'judge', judged: items.length, removed: removed.length },
      'answer prose judged',
    );
    await run.saveStep('judge', { removed }, 'finalize');
  }

  private async finalizeContent(
    run: JobRun,
    questionId: string,
    target: QuestionTarget,
  ): Promise<void> {
    const written = applyWriteResultSchema.parse(run.job.state.write);
    const judged = judgeResultSchema.parse(run.job.state.judge);
    const rejected = new Set(judged.removed.map((item) => item.itemId));
    const passing = written.items.filter((item) => !rejected.has(item.id));
    const patch: Patch = positionOf(target)
      ? { kind: 'bullets', bullets: passing }
      : { kind: 'summary', sentences: passing };
    await this.apply(run, questionId, target, patch, {
      answerFact: written.answerFact,
      partial: written.removed.length + judged.removed.length > 0,
    });
  }

  /**
   * One fenced transaction: the document read fresh, only the target changed (version + 1), the answer
   * kept as a fact, and the question's outcome. A target that no longer exists changes nothing.
   */
  private async apply(
    run: JobRun,
    questionId: string,
    target: QuestionTarget,
    patch: Patch | null,
    regenerated?: Regenerated,
  ): Promise<void> {
    const { job } = run;
    await run.finish(async (tx) => {
      const cv = await tx.findOne(Cv, { id: job.cvId, user: job.userId }, { refresh: true });
      if (!cv) throw new LeaseLostError();
      const now = this.clock.now();
      const result = cv.document && patch ? applyPatch(cv.document, target, patch) : null;
      if (result?.kind !== 'patched') {
        const note = result?.kind === 'mismatch' ? NOTES.mismatch : NOTES.gone;
        await outcome(tx, questionId, job.cvId, 'failed', note, now);
        this.log.info({ jobId: job.id, step: 'finalize', applied: 'failed' }, 'answer not applied');
        return;
      }
      if (result.document !== cv.document) {
        await replaceDocument(tx, cv, cvDocumentSchema.parse(result.document), now);
      }
      // The answer is the user's own statement: it is kept even when none of the new text passed.
      if (regenerated) await keepAnswerFact(tx, job.cvId, regenerated.answerFact);
      const partial = result.partial || Boolean(regenerated?.partial);
      const note = partial ? (result.note ?? NOTES.partial) : null;
      await outcome(tx, questionId, job.cvId, partial ? 'partial' : 'applied', note, now);
      this.log.info(
        { jobId: job.id, step: 'finalize', applied: partial ? 'partial' : 'applied' },
        'answer applied',
      );
    });
  }
}

function positionOf(target: QuestionTarget): string | null {
  return target.section === 'experience' ? (target.itemId ?? null) : null;
}

/** A content answer regenerates a position's bullets or the summary, if the document still has them. */
function targetExists(cv: ICv, target: QuestionTarget): boolean {
  if (!cv.document) return false;
  if (target.section === 'summary') return true;
  const positionId = positionOf(target);
  return positionId !== null && cv.document.experience.some((job) => job.id === positionId);
}

/** Later answers to the same position build on this one, so the fact is stored with the source facts. */
async function keepAnswerFact(tx: EntityManager, cvId: string, fact: Fact): Promise<void> {
  const source = await loadSource(tx, cvId);
  const facts = requiredFacts(source?.facts ?? null);
  await tx.nativeUpdate(
    CvSource,
    { cv: cvId },
    { facts: { ...facts, answers: [...facts.answers, fact] } },
  );
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
