import { Module, type DynamicModule, type Type } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Logger } from 'pino';
import { AuthModule } from './auth/auth.module.js';
import { CommonModule } from './common/common.module.js';
import { AppConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/env.js';
import { APP_CONFIG } from './config/tokens.js';
import { CvsModule } from './cvs/cvs.module.js';
import { DbModule } from './db/db.module.js';
import { GenerationModule } from './generation/generation.module.js';
import { HealthModule } from './health/health.module.js';
import { LlmModule } from './llm/llm.module.js';
import { PdfModule } from './pdf/pdf.module.js';
import { SourcesModule } from './sources/sources.module.js';

@Module({})
export class AppModule {
  static forRoot(
    config: AppConfig,
    logger: Logger,
    extraImports: (Type | DynamicModule)[] = [],
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(config, logger),
        // Routes opt in with `@UseGuards(ThrottlerGuard)`; the auth controller applies it to signup and login.
        ThrottlerModule.forRootAsync({
          inject: [APP_CONFIG],
          useFactory: (c: AppConfig) => [{ ttl: 60_000, limit: c.AUTH_RATE_LIMIT_PER_MINUTE }],
        }),
        DbModule,
        CommonModule,
        AuthModule,
        CvsModule,
        SourcesModule,
        GenerationModule,
        LlmModule,
        PdfModule,
        HealthModule,
        ...extraImports,
      ],
    };
  }
}
