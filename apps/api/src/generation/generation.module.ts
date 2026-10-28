import { Module } from '@nestjs/common';
import { Clock, SystemClock } from './clock.js';
import { GenerationWorker } from './generation-worker.js';
import { JobEngine } from './job-engine.js';
import { JOB_HANDLERS, type JobHandlers } from './job-handler.js';
import { JobStore } from './job-store.js';
import { JobController } from './job.controller.js';

@Module({
  controllers: [JobController],
  providers: [
    { provide: Clock, useClass: SystemClock },
    // The pipeline steps of `generate` and `apply_answer` register here.
    { provide: JOB_HANDLERS, useValue: {} satisfies JobHandlers },
    JobStore,
    JobEngine,
    GenerationWorker,
  ],
})
export class GenerationModule {}
