import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { GenerationQueue } from './generation-queue.js';
import { OwnedCvs } from './owned-cvs.js';
import { SessionGuard } from './session.guard.js';

/**
 * Shared building blocks of the API modules: the global session guard, owner-scoped access to CVs and the
 * generation queue. The error filter is global and installed in `bootstrap.ts`.
 */
@Global()
@Module({
  providers: [OwnedCvs, GenerationQueue, { provide: APP_GUARD, useClass: SessionGuard }],
  exports: [OwnedCvs, GenerationQueue],
})
export class CommonModule {}
