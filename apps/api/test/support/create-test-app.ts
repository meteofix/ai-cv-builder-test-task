import type { DynamicModule, Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { pino } from 'pino';
import { createApp } from '../../src/bootstrap.js';
import type { AppConfig } from '../../src/config/env.js';
import { testConfig } from './test-config.js';

export interface TestAppOptions {
  /** Extra modules, for example a probe controller that exposes what a route sees. */
  imports?: (Type | DynamicModule)[];
}

/** The production wiring on the test database; send requests with `inject(app, ...)`. */
export async function createTestApp(
  overrides: Partial<AppConfig> = {},
  options: TestAppOptions = {},
): Promise<NestFastifyApplication> {
  const config = testConfig(overrides);
  const app = await createApp(config, pino({ level: 'silent' }), { imports: options.imports });
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
