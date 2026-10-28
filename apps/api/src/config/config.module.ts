import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { Logger } from 'pino';
import type { AppConfig } from './env.js';
import { APP_CONFIG, ROOT_LOGGER } from './tokens.js';

@Global()
@Module({})
export class AppConfigModule {
  static forRoot(config: AppConfig, logger: Logger): DynamicModule {
    return {
      module: AppConfigModule,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: ROOT_LOGGER, useValue: logger },
      ],
      exports: [APP_CONFIG, ROOT_LOGGER],
    };
  }
}
