import {
  Inject,
  Injectable,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import { APP_CONFIG, ROOT_LOGGER } from '../config/tokens.js';
import { errorFields } from './error-fields.js';
import { JobEngine, settleWithin } from './job-engine.js';

const IDLE_MS = 1_000;
const SHUTDOWN_WAIT_MS = 5_000;
/** Waits after consecutive failed iterations (for example the database is down); the loop never gives up. */
const FAILURE_BACKOFF_MS = [1_000, 5_000, 30_000] as const;

/** The background loop of this process: claims and runs jobs while `WORKER_ENABLED` is true. */
@Injectable()
export class GenerationWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly stop = new AbortController();
  private loop: Promise<void> | undefined;
  private readonly log: Logger;

  constructor(
    @Inject(JobEngine) private readonly engine: JobEngine,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ROOT_LOGGER) logger: Logger,
  ) {
    this.log = logger.child({ module: 'generation', workerId: engine.workerId });
  }

  onApplicationBootstrap(): void {
    if (!this.config.WORKER_ENABLED) return;
    this.loop = this.run();
    this.log.info('generation worker started');
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stop.abort();
    // Nest runs the shutdown hooks of one module in parallel: the engine's hook aborts and releases the
    // job in flight meanwhile, which ends this iteration. The bound keeps a stuck job from holding shutdown.
    if (this.loop) await settleWithin(this.loop, SHUTDOWN_WAIT_MS);
  }

  private async run(): Promise<void> {
    let failures = 0;
    while (!this.stop.signal.aborted) {
      try {
        const worked = await this.engine.processNext();
        failures = 0;
        if (!worked) await this.pause(IDLE_MS);
      } catch (error) {
        const wait = FAILURE_BACKOFF_MS[Math.min(failures, FAILURE_BACKOFF_MS.length - 1)] ?? 0;
        failures++;
        this.log.error(
          { err: errorFields(error), waitMs: wait },
          'generation worker iteration failed',
        );
        await this.pause(wait);
      }
    }
  }

  /** Sleeps unless shutdown starts first. */
  private pause(ms: number): Promise<void> {
    const signal = this.stop.signal;
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}
