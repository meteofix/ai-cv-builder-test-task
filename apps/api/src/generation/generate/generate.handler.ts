import { EntityManager } from '@mikro-orm/postgresql';
import { Inject, Injectable } from '@nestjs/common';
import { cvDocumentSchema } from '@cv/shared';
import type { Logger } from 'pino';
import { ROOT_LOGGER } from '../../config/tokens.js';
import { Cv, CvQuestion, CvSource, type ICv } from '../../db/entities.js';
import { LlmClient } from '../../llm/llm-client.js';
import { Clock } from '../clock.js';
import { authorOutputSchema, type AuthorOutput } from '../compose/author-schema.js';
import {
  authorRequest,
  compose,
  prepareSource,
  reviewRequest,
  type ModelRequest,
  type PreparedSource,
} from '../compose/compose.js';
import { reviewOutputSchema } from '../compose/review.js';
import type { JobHandler, JobRun } from '../job-handler.js';
import { LeaseLostError } from '../job-errors.js';
import { replaceDocument } from './document-write.js';

/**
 * The `generate` job: write (author) → judge (reviewer) → finalize (docs/specs/generation.md §3). Each
 * model answer is stored with the next step in one fenced update, so a restart resumes where it stopped.
 */
@Injectable()
export class GenerateHandler implements JobHandler {
  private readonly log: Logger;

  constructor(
    @Inject(LlmClient) private readonly llm: LlmClient,
    @Inject(EntityManager) private readonly em: EntityManager,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(ROOT_LOGGER) logger: Logger,
  ) {
    this.log = logger.child({ module: 'generation' });
  }

  firstStep(): 'write' {
    return 'write';
  }

  async run(run: JobRun): Promise<void> {
    const { job } = run;
    const em = this.em.fork();
    // The worker has no session; the job's user is the owner it is scoped to all the same.
    const cv = await em.findOne(Cv, { id: job.cvId, user: job.userId });
    const stored = await em.findOne(CvSource, { cv: job.cvId });
    // The CV was deleted: its job is gone too, so nothing may be written.
    if (!cv || !stored) throw new LeaseLostError();
    const source = prepareSource(stored.text);

    // An answer stored in an earlier shape (a deploy between the steps) cannot be read: write it again.
    const stale = job.step !== 'write' && !authorOutputSchema.safeParse(job.state.write).success;
    if (job.step === 'write' || stale) await this.write(run, cv, source);
    if (job.step === 'judge') await this.review(run, cv, source);
    if (job.step === 'finalize') await this.finalize(run, source);
  }

  private ask<T>(run: JobRun, request: ModelRequest<T>): Promise<T> {
    return this.llm.parse({ ...request, job: run.job, signal: run.signal });
  }

  private async write(run: JobRun, cv: ICv, source: PreparedSource): Promise<void> {
    const output = await this.ask(run, authorRequest(source, cv.targetRole, this.clock.now()));
    this.log.info(
      {
        jobId: run.job.id,
        step: 'write',
        segments: source.segments.length,
        ignored: source.segments.filter((segment) => segment.instruction).length,
        jobs: output.experience.length,
      },
      'cv written',
    );
    await run.saveStep('write', output, 'judge');
  }

  private async review(run: JobRun, cv: ICv, source: PreparedSource): Promise<void> {
    const author = this.authored(run);
    const review = await this.ask(
      run,
      reviewRequest(source, author, cv.targetRole, this.clock.now()),
    );
    this.log.info(
      {
        jobId: run.job.id,
        step: 'judge',
        fix: review.issues.filter((issue) => issue.action === 'fix').length,
        ask: review.issues.filter((issue) => issue.action === 'ask').length,
        classes: review.issues.map((issue) => issue.class),
      },
      'cv reviewed',
    );
    await run.saveStep('judge', review, 'finalize');
  }

  private async finalize(run: JobRun, source: PreparedSource): Promise<void> {
    const { job } = run;
    const author = this.authored(run);
    const review = reviewOutputSchema.parse(job.state.judge);
    await run.finish(async (tx) => {
      // Fresh inside the transaction: the document is replaced on the version read here.
      const cv = await tx.findOne(Cv, { id: job.cvId, user: job.userId }, { refresh: true });
      if (!cv) throw new LeaseLostError();
      const composed = compose(source, author, review, cv.targetRole);
      const document = cvDocumentSchema.parse(composed.document);
      const now = this.clock.now();
      await replaceDocument(tx, cv, document, now);
      await tx.nativeUpdate(CvSource, { cv: job.cvId }, { facts: composed.analysis });
      // One flush gives every row the same time; the API orders questions by `createdAt`.
      composed.questions.forEach((question, i) => {
        tx.create(CvQuestion, { ...question, cv, createdAt: new Date(now.getTime() + i) });
      });
      await tx.flush();
      this.log.info(
        {
          jobId: job.id,
          step: 'finalize',
          questions: composed.questions.length,
          ...composed.counts,
        },
        'cv finished',
      );
    });
  }

  /** The author's answer as the write step stored it; it passed the full schema before it was stored. */
  private authored(run: JobRun): AuthorOutput {
    return authorOutputSchema.parse(run.job.state.write);
  }
}
