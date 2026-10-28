import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module.js';
import { Clock, SystemClock } from './clock.js';
import { DraftController } from './draft.controller.js';
import { GenerateHandler } from './generate/generate.handler.js';
import { GenerationWorker } from './generation-worker.js';
import { JobEngine } from './job-engine.js';
import { JOB_HANDLERS, type JobHandlers } from './job-handler.js';
import { JobStore } from './job-store.js';
import { JobController } from './job.controller.js';

@Module({
  imports: [LlmModule],
  controllers: [JobController, DraftController],
  providers: [
    { provide: Clock, useClass: SystemClock },
    GenerateHandler,
    {
      provide: JOB_HANDLERS,
      inject: [GenerateHandler],
      useFactory: (generate: GenerateHandler): JobHandlers => ({ generate }),
    },
    JobStore,
    JobEngine,
    GenerationWorker,
  ],
})
export class GenerationModule {}
