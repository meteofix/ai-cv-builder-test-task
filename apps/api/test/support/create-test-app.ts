import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { pino } from 'pino';
import { createApp } from '../../src/bootstrap.js';
import type { AppConfig } from '../../src/config/env.js';
import { testConfig } from './test-config.js';

/** The production wiring on the test database; requests go through `app.getHttpAdapter().getInstance().inject()`. */
export async function createTestApp(
  overrides: Partial<AppConfig> = {},
): Promise<NestFastifyApplication> {
  const config = testConfig(overrides);
  const app = await createApp(config, pino({ level: 'silent' }));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
