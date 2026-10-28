import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { pino } from 'pino';
import type { AppConfig } from '../../src/config/env.js';
import { ROOT_LOGGER } from '../../src/config/tokens.js';
import { Clock } from '../../src/generation/clock.js';
import {
  JOB_HANDLERS,
  type JobHandler,
  type JobHandlers,
  type JobRun,
} from '../../src/generation/job-handler.js';
import { GenerationJob } from '../../src/db/entities.js';
import { createTestApp } from '../support/create-test-app.js';
import { entityManager } from '../support/db.js';
import { FakeClock } from './fake-clock.js';

export interface HandlerCall {
  step: string | null;
  state: Record<string, unknown>;
  attempts: number;
}

/** The log lines the app wrote, parsed. */
export type LogLine = Record<string, unknown> & { msg?: string; level?: number };

/**
 * A job engine whose handlers run a script the test sets, with a hand-moved clock and captured logs.
 * `script` defaults to finishing the job at once.
 */
export function engineHarness() {
  const clock = new FakeClock();
  const calls: HandlerCall[] = [];
  const logs: LogLine[] = [];
  const finishNow = (run: JobRun) => run.finish(() => Promise.resolve());
  let script: (run: JobRun) => Promise<void> = finishNow;
  const handler: JobHandler = {
    firstStep: () => 'extract',
    run: (run) => {
      calls.push({ step: run.job.step, state: { ...run.job.state }, attempts: run.job.attempts });
      return script(run);
    },
  };
  const handlers: JobHandlers = {
    generate: handler,
    apply_answer: { ...handler, firstStep: () => 'finalize' },
  };
  const logger = pino(
    { level: 'info' },
    {
      write: (line: string) => {
        logs.push(JSON.parse(line) as LogLine);
      },
    },
  );

  return {
    clock,
    calls,
    logs,
    handlers,
    setScript(next: (run: JobRun) => Promise<void>) {
      script = next;
    },
    reset() {
      clock.reset();
      calls.length = 0;
      logs.length = 0;
      script = finishNow;
    },
    start(config: Partial<AppConfig> = {}): Promise<NestFastifyApplication> {
      return createTestApp(config, {
        overrides: [
          { provide: Clock, useValue: clock },
          { provide: JOB_HANDLERS, useValue: handlers },
          { provide: ROOT_LOGGER, useValue: logger },
        ],
      });
    },
  };
}

export function jobRow(app: NestFastifyApplication, id: string) {
  return entityManager(app).findOneOrFail(GenerationJob, id);
}

/** A promise with its resolve function, for a handler that waits until the test lets it go. */
export function signal(): { promise: Promise<void>; fire: () => void } {
  let fire!: () => void;
  const promise = new Promise<void>((resolve) => (fire = resolve));
  return { promise, fire };
}
