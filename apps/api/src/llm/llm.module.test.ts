import { describe, expect, it } from 'vitest';
import { llmSleep } from './llm.module.js';

describe('llmSleep', () => {
  it('waits the given time', async () => {
    const started = Date.now();
    await llmSleep(30, new AbortController().signal);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });

  it('rejects at once when the job is aborted during the wait', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const waiting = llmSleep(10_000, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
