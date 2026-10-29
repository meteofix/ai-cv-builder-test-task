import { EntityManager } from '@mikro-orm/postgresql';
import { Inject, Injectable } from '@nestjs/common';
import { cvDocumentSchema } from '@cv/shared';
import type { Logger } from 'pino';
import { ROOT_LOGGER } from '../../config/tokens.js';
import { Cv, CvQuestion, CvSource, type ICv } from '../../db/entities.js';
import { LlmClient } from '../../llm/llm-client.js';
import { Clock } from '../clock.js';
import type { JobHandler, JobRun } from '../job-handler.js';
import { LeaseLostError } from '../job-errors.js';
import { countBy, extractSourceFacts } from './extract-step.js';
import { WRITER_SYSTEM, writerInput } from './prompts.js';
import {
  currentClaims,
  isCurrentClaim,
  judgeEvidence,
  judgeProse,
  type ItemToJudge,
} from './judge-step.js';
import { checkProse } from './prose-checks.js';
import { buildQuestions } from './questions.js';
import {
  judgeResultSchema,
  writeResultSchema,
  writerOutputSchema,
  type SourceFacts,
  type WriteResult,
} from './schemas.js';
import { buildSkeleton, type Prose } from './skeleton.js';
import { replaceDocument } from './document-write.js';
import { loadSource, requiredFacts as required } from './source-facts.js';

/**
 * The `generate` job: extract → write → judge → finalize (docs/specs/generation.md §3). Each step stores
 * its result with the next step in one fenced update, so a restart resumes where it stopped.
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

  firstStep(): 'extract' {
    return 'extract';
  }

  async run(run: JobRun): Promise<void> {
    const { job } = run;
    const em = this.em.fork();
    // The worker has no session; the job's user is the owner it is scoped to all the same.
    const cv = await em.findOne(Cv, { id: job.cvId, user: job.userId });
    const source = await loadSource(em, job.cvId);
    // The CV was deleted: its job is gone too, so nothing may be written.
    if (!cv || !source) throw new LeaseLostError();

    if (job.step === 'extract') source.facts = await this.extract(run, source.text);
    const facts = required(source.facts);
    if (job.step === 'write') await this.write(run, cv, source.text, facts);
    if (job.step === 'judge') await this.judge(run, cv, source.text, facts);
    if (job.step === 'finalize') await this.finalize(run);
  }

  private async extract(run: JobRun, text: string): Promise<SourceFacts> {
    const { stored, counters } = await extractSourceFacts(text, (request) =>
      this.llm.parse({ ...request, role: 'extractor', job: run.job, signal: run.signal }),
    );
    this.log.info({ jobId: run.job.id, step: 'extract', ...counters }, 'facts verified');
    await run.saveStep('extract', counters, 'write', async (tx) => {
      await tx.nativeUpdate(CvSource, { cv: run.job.cvId }, { facts: stored });
    });
    return stored;
  }

  private async write(run: JobRun, cv: ICv, text: string, source: SourceFacts): Promise<void> {
    // The writer sees verified facts only, never the source text.
    const output = await this.llm.parse({
      role: 'writer',
      system: WRITER_SYSTEM,
      input: writerInput({ facts: source.facts, targetRole: cv.targetRole, locale: source.locale }),
      schema: writerOutputSchema,
      job: run.job,
      signal: run.signal,
    });
    const { result, unknownPositions } = checkProse(output, source.facts, text);
    this.log.info(
      {
        jobId: run.job.id,
        step: 'write',
        removed: countBy(result.removed.map((item) => item.class)),
        unknownPositions,
      },
      'prose checked',
    );
    await run.saveStep('write', result, 'judge');
  }

  private async judge(run: JobRun, cv: ICv, text: string, source: SourceFacts): Promise<void> {
    const written = writeResultSchema.parse(run.job.state.write);
    const { destination, evidence } = judgeEvidence(
      source.facts,
      text,
      text.length,
      source.uncoveredLines,
      source.sectionHeadings,
      source.instructionSpans,
    );
    const prose: ItemToJudge[] = [
      ...written.summary.map((item) => ({ ...item, positionId: null })),
      ...written.positions.flatMap(({ positionId, bullets }) =>
        bullets.map((item) => ({ ...item, positionId })),
      ),
    ].map(({ id, text: itemText, factIds, positionId }) => ({
      id,
      text: itemText,
      positionId,
      destination: destination(positionId),
      evidence: evidence(factIds, positionId),
    }));
    const items = [...prose, ...currentClaims(source.facts, evidence)];
    const removed = await judgeProse(this.llm, run, items, cv.targetRole);
    this.log.info(
      {
        jobId: run.job.id,
        step: 'judge',
        judged: items.length,
        removed: countBy(removed.map((item) => item.class)),
      },
      'prose judged',
    );
    await run.saveStep('judge', { removed }, 'finalize');
  }

  private async finalize(run: JobRun): Promise<void> {
    const { job } = run;
    const written = writeResultSchema.parse(job.state.write);
    const judged = judgeResultSchema.parse(job.state.judge);
    await run.finish(async (tx) => {
      // Fresh inside the transaction: the document is replaced on the version read here.
      const cv = await tx.findOne(Cv, { id: job.cvId, user: job.userId }, { refresh: true });
      const source = await loadSource(tx, job.cvId);
      if (!cv || !source) throw new LeaseLostError();
      const facts = required(source.facts);
      const rejected = new Set(judged.removed.map((item) => item.itemId));
      // A rejected "still in this role" makes the job not current; its open end becomes a dates question.
      const notCurrent = new Set(
        judged.removed.filter(isCurrentClaim).flatMap((item) => item.positionId ?? []),
      );
      const judgedFacts = facts.facts.map((fact) =>
        fact.kind === 'position' && notCurrent.has(fact.id)
          ? { ...fact, position: { ...fact.position, current: false } }
          : fact,
      );
      const removedProse = judged.removed.filter((item) => !isCurrentClaim(item));
      // Later answers build on the stored facts, so they must not bring back a rejected "current".
      if (notCurrent.size > 0) {
        await tx.nativeUpdate(
          CvSource,
          { cv: job.cvId },
          { facts: { ...facts, facts: judgedFacts } },
        );
      }
      const document = buildSkeleton({
        source: source.text,
        facts: judgedFacts,
        targetRole: cv.targetRole,
        locale: facts.locale,
        prose: passingProse(written, rejected),
      });
      const valid = cvDocumentSchema.parse(document);
      const now = this.clock.now();
      await replaceDocument(tx, cv, valid, now);
      const questions = buildQuestions({
        source: source.text,
        document: valid,
        facts: judgedFacts,
        removed: [...written.removed, ...removedProse],
        notCurrent,
      });
      // One flush gives every row the same time; the API orders questions by `createdAt`.
      questions.forEach((question, i) => {
        tx.create(CvQuestion, { ...question, cv, createdAt: new Date(now.getTime() + i) });
      });
      await tx.flush();
      this.log.info({ jobId: job.id, step: 'finalize', questions: questions.length }, 'cv written');
    });
  }
}

function passingProse(written: WriteResult, rejected: ReadonlySet<string>): Prose {
  const passes = (item: { id: string }) => !rejected.has(item.id);
  return {
    summary: written.summary.filter(passes),
    bullets: new Map(
      written.positions.map(({ positionId, bullets }) => [positionId, bullets.filter(passes)]),
    ),
    skills: written.skills,
  };
}
