import { EntityManager } from '@mikro-orm/postgresql';
import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '../config/env.js';
import { APP_CONFIG } from '../config/tokens.js';
import { JobError, LeaseLostError } from '../generation/job-errors.js';

export interface BudgetedJob {
  id: string;
  /** The worker that holds the job; the charge is fenced by it like every other write of the job. */
  lockedBy: string;
}

/**
 * The per-job cap on HTTP attempts. Every attempt — a transport retry, a schema re-ask or a new job
 * attempt — is charged here first, so the retry layers cannot multiply the calls.
 */
@Injectable()
export class LlmCallBudget {
  constructor(
    @Inject(EntityManager) private readonly em: EntityManager,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Takes one call from the budget, or throws: AI_LIMIT_REACHED when it is used up, lease lost otherwise. */
  async charge(job: BudgetedJob): Promise<void> {
    const em = this.em.fork();
    const charged = await em.execute<{ id: string }[]>(
      `update generation_jobs set llm_calls = llm_calls + 1
        where id = ? and locked_by = ? and status = 'running' and llm_calls < ?
        returning id`,
      [job.id, job.lockedBy, this.config.LLM_CALL_BUDGET],
    );
    if (charged.length > 0) return;
    const held = await em.execute<{ id: string }[]>(
      `select id from generation_jobs where id = ? and locked_by = ? and status = 'running'`,
      [job.id, job.lockedBy],
    );
    if (held.length === 0) throw new LeaseLostError();
    throw new JobError('AI_LIMIT_REACHED');
  }
}
