import { setTimeout as delay } from 'node:timers/promises';
import { Module } from '@nestjs/common';
import type { AppConfig } from '../config/env.js';
import { APP_CONFIG } from '../config/tokens.js';
import { ANTHROPIC_SDK, AnthropicTransport, createAnthropicSdk } from './anthropic-transport.js';
import { LlmCallBudget } from './llm-budget.js';
import { LLM_SLEEP, LlmClient, type LlmSleep } from './llm-client.js';
import { LlmTransport } from './llm-transport.js';

/** Rejects with the signal's reason when the job is aborted during the wait. */
export const llmSleep: LlmSleep = async (ms, signal) => {
  await delay(ms, undefined, { signal });
};

@Module({
  providers: [
    {
      provide: ANTHROPIC_SDK,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) => createAnthropicSdk(c),
    },
    { provide: LlmTransport, useClass: AnthropicTransport },
    { provide: LLM_SLEEP, useValue: llmSleep },
    LlmCallBudget,
    LlmClient,
  ],
  exports: [LlmClient],
})
export class LlmModule {}
