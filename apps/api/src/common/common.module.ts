import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { OwnedCvs } from './owned-cvs.js';
import { SessionGuard } from './session.guard.js';

/** Shared building blocks of the API modules: the global session guard and owner-scoped access to CVs. */
@Global()
@Module({
  providers: [OwnedCvs, { provide: APP_GUARD, useClass: SessionGuard }],
  exports: [OwnedCvs],
})
export class CommonModule {}
