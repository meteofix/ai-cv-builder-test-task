import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AppConfig } from '../../src/config/env.js';
import { Clock } from '../../src/generation/clock.js';
import { LLM_SLEEP } from '../../src/llm/llm-client.js';
import { LlmTransport } from '../../src/llm/llm-transport.js';
import { createTestApp } from '../support/create-test-app.js';
import { FakeClock } from './fake-clock.js';
import { FakeLlmClient } from './fake-llm.js';

/** The real pipeline with a scripted model, a hand-moved clock and no real waits between retries. */
export function pipelineHarness() {
  const fake = new FakeLlmClient();
  const clock = new FakeClock();
  return {
    fake,
    clock,
    start(config: Partial<AppConfig> = {}): Promise<NestFastifyApplication> {
      return createTestApp(config, {
        overrides: [
          { provide: LlmTransport, useValue: fake },
          { provide: Clock, useValue: clock },
          { provide: LLM_SLEEP, useValue: () => Promise.resolve() },
        ],
      });
    },
  };
}
