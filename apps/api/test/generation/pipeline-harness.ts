import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AppConfig } from '../../src/config/env.js';
import { Clock } from '../../src/generation/clock.js';
import type { JudgedItem } from '../../src/generation/generate/prompts.js';
import { LLM_SLEEP } from '../../src/llm/llm-client.js';
import { LlmTransport, type TransportRequest } from '../../src/llm/llm-transport.js';
import { createTestApp } from '../support/create-test-app.js';
import { FakeClock } from './fake-clock.js';
import { FakeLlmClient, userText, type FakeAnswer } from './fake-llm.js';

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

/** The items the judge was asked about, read back from its request. */
export function judgedItems(request: TransportRequest<unknown>): JudgedItem[] {
  const json =
    /<cv_source>\n([\s\S]*)\n<\/cv_source>/.exec(userText(request))?.[1] ?? '{"items":[]}';
  return (JSON.parse(json) as { items: JudgedItem[] }).items;
}

/** A judge that supports every item except those `reject` returns a class for. */
export function judgeAnswer(
  reject: (item: JudgedItem) => string | null = () => null,
  omit: (item: JudgedItem) => boolean = () => false,
): FakeAnswer {
  return (request) => ({
    output: {
      verdicts: judgedItems(request)
        .filter((item) => !omit(item))
        .map((item) => {
          const rejected = reject(item);
          return rejected === null
            ? { itemId: item.id, supported: true }
            : { itemId: item.id, supported: false, class: rejected, reason: 'not in the quotes' };
        }),
    },
  });
}
