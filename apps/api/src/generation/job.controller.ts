import { EntityManager } from '@mikro-orm/postgresql';
import { Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ROUTES, type Job } from '@cv/shared';
import { ApiError } from '../common/api-error.js';
import { CurrentUser, type SessionUser } from '../common/current-user.js';
import { GenerationQueue } from '../common/generation-queue.js';
import { OwnedCvs } from '../common/owned-cvs.js';

/** `GET /api/cvs/:id/job` and `POST /api/cvs/:id/job/retry`; the queue owns the logic and the `Job` shape. */
@Controller('cvs/:id/job')
export class JobController {
  constructor(
    @Inject(OwnedCvs) private readonly cvs: OwnedCvs,
    @Inject(GenerationQueue) private readonly queue: GenerationQueue,
    @Inject(EntityManager) private readonly em: EntityManager,
  ) {}

  @Get()
  async get(@Param('id') id: string, @CurrentUser() user: SessionUser): Promise<Job> {
    const cv = await this.cvs.findOwned(id, user.id);
    const job = await this.queue.getLatestJob(cv.id);
    // Every CV is created together with its first job, so this happens only for rows made outside the API.
    if (!job) throw new ApiError('NOT_FOUND', 'This CV has no generation job.');
    return job;
  }

  @Post('retry')
  @HttpCode(ROUTES.retryJob.status)
  async retry(@Param('id') id: string, @CurrentUser() user: SessionUser): Promise<Job> {
    const cv = await this.cvs.findOwned(id, user.id);
    return this.queue.retry(this.em, cv);
  }
}
