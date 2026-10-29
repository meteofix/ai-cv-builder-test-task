import type { DynamicModule, InjectionToken, Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { pino } from 'pino';
import { AppModule } from '../../src/app.module.js';
import { configureApp, createAdapter, nestOptions } from '../../src/bootstrap.js';
import type { AppConfig } from '../../src/config/env.js';
import { testConfig } from './test-config.js';

export interface TestAppOptions {
  /** Extra modules, for example a probe controller that exposes what a route sees. */
  imports?: (Type | DynamicModule)[];
  /** Providers replaced by test doubles, for example the LLM transport: `{ provide: LlmTransport, useValue: fake }`. */
  overrides?: { provide: InjectionToken; useValue: unknown }[];
  /** Runs after the app is built and before routes are registered, for example to add an `onRoute` hook. */
  beforeInit?: (app: NestFastifyApplication) => void;
}

/**
 * The production wiring (`createAdapter`, `configureApp`) on the test database; send requests with
 * `inject(app, ...)`.
 */
export async function createTestApp(
  overrides: Partial<AppConfig> = {},
  options: TestAppOptions = {},
): Promise<NestFastifyApplication> {
  const config = testConfig(overrides);
  const logger = pino({ level: 'silent' });
  let builder = Test.createTestingModule({
    imports: [AppModule.forRoot(config, logger, options.imports)],
  });
  for (const { provide, useValue } of options.overrides ?? []) {
    builder = builder.overrideProvider(provide).useValue(useValue);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    createAdapter(config, logger),
    nestOptions(logger),
  );
  configureApp(app, config);
  options.beforeInit?.(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

export function inject(
  app: NestFastifyApplication,
  options: InjectOptions,
): Promise<LightMyRequestResponse> {
  return app.getHttpAdapter().getInstance().inject(options);
}
