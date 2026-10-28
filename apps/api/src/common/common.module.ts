import { Global, Module } from '@nestjs/common';

/** Shared building blocks of the API streams (session guard, owner-scoped access, generation queue); filled in W0.4 and W0.5. */
@Global()
@Module({})
export class CommonModule {}
