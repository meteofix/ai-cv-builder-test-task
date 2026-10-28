import { EntityManager } from '@mikro-orm/postgresql';
import { Inject, Injectable } from '@nestjs/common';
import type { CreateCvResponse, CvDetail, CvListItem } from '@cv/shared';
import { GenerationQueue } from '../common/generation-queue.js';
import { OwnedCvs } from '../common/owned-cvs.js';
import { Cv, CvQuestion, CvSource, GenerationJob, User } from '../db/entities.js';
import { toCvDetail, toCvListItem } from './cv-mapper.js';
import { assertNoNul } from './no-nul.js';

@Injectable()
export class CvsService {
  constructor(
    @Inject(EntityManager) private readonly em: EntityManager,
    @Inject(OwnedCvs) private readonly owned: OwnedCvs,
    @Inject(GenerationQueue) private readonly queue: GenerationQueue,
  ) {}

  /**
   * Stores the CV with its source text and queues the generation in one transaction. When the queue refuses
   * (the daily limit), nothing is left behind.
   */
  create(
    userId: string,
    input: { targetRole: string; kind: 'text' | 'pdf'; text: string },
  ): Promise<CreateCvResponse> {
    assertNoNul(input.targetRole, 'targetRole');
    assertNoNul(input.text, 'text');
    return this.em.fork().transactional(async (tx) => {
      const cv = tx.create(Cv, {
        user: tx.getReference(User, userId),
        targetRole: input.targetRole,
        document: null,
        version: 0,
      });
      tx.create(CvSource, { cv, kind: input.kind, text: input.text });
      await tx.flush();
      const job = await this.queue.enqueue(tx, cv, { kind: 'generate' });
      return { cvId: cv.id, job };
    });
  }

  async list(userId: string): Promise<CvListItem[]> {
    const em = this.em.fork();
    const cvs = await em.find(Cv, { user: userId }, { orderBy: { updatedAt: 'desc', id: 'asc' } });
    if (cvs.length === 0) return [];
    const ids = cvs.map((cv) => cv.id);

    // One query per concern, however many CVs there are. Newest job first, so the first row per CV is the latest.
    const jobs = await em.find(
      GenerationJob,
      { cv: { $in: ids } },
      {
        fields: ['cv', 'kind', 'status'],
        orderBy: { createdAt: 'desc', id: 'desc' },
      },
    );
    const latestJob = new Map<string, (typeof jobs)[number]>();
    for (const job of jobs) if (!latestJob.has(job.cv.id)) latestJob.set(job.cv.id, job);

    const open = await em.find(
      CvQuestion,
      { cv: { $in: ids }, status: 'open' },
      { fields: ['cv'] },
    );
    const openByCv = new Map<string, number>();
    for (const question of open) {
      openByCv.set(question.cv.id, (openByCv.get(question.cv.id) ?? 0) + 1);
    }

    return cvs.map((cv) => toCvListItem(cv, latestJob.get(cv.id), openByCv.get(cv.id) ?? 0));
  }

  async detail(id: string, userId: string): Promise<CvDetail> {
    const em = this.em.fork();
    const cv = await this.owned.findOwned(id, userId, em);
    const job = await this.queue.getLatestJob(cv.id, em);
    const questions = await em.find(
      CvQuestion,
      { cv: cv.id },
      { orderBy: { createdAt: 'asc', id: 'asc' } },
    );
    return toCvDetail(cv, job, questions);
  }

  /** The rows of the source, questions and jobs go with the CV (`ON DELETE CASCADE`), also while a job runs. */
  async remove(id: string, userId: string): Promise<void> {
    const em = this.em.fork();
    const cv = await this.owned.findOwned(id, userId, em);
    // A native delete does not load the CV's children: the foreign keys do the cascade.
    await em.nativeDelete(Cv, { id: cv.id, user: userId });
  }
}
