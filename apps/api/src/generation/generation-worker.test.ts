import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/env.js';
import { GenerationWorker } from './generation-worker.js';
import type { JobEngine } from './job-engine.js';

describe('GenerationWorker loop', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function workerWith(results: (boolean | Error)[], enabled = true) {
    const calledAt: number[] = [];
    const engine = {
      workerId: 'test-worker',
      processNext: vi.fn(() => {
        calledAt.push(Date.now());
        const next = results.shift() ?? false;
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
      }),
    };
    const worker = new GenerationWorker(
      engine as unknown as JobEngine,
      { WORKER_ENABLED: enabled } as AppConfig,
      pino({ level: 'silent' }),
    );
    return { worker, engine, calledAt };
  }

  it('backs off 1 s, 5 s, then 30 s after failed iterations, resets after a success and idles 1 s', async () => {
    vi.useFakeTimers();
    const down = new Error('database is down');
    const { worker, calledAt } = workerWith([down, down, down, down, true, down, false]);
    worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(68_000);
    await worker.beforeApplicationShutdown();

    const gaps = calledAt.slice(1, 8).map((at, i) => at - (calledAt[i] ?? 0));
    expect(gaps).toEqual([1_000, 5_000, 30_000, 30_000, 0, 1_000, 1_000]);
  });

  it('does not start when WORKER_ENABLED is false', async () => {
    vi.useFakeTimers();
    const { worker, engine } = workerWith([], false);
    worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(engine.processNext).not.toHaveBeenCalled();
    await worker.beforeApplicationShutdown();
  });

  it('stops claiming once shutdown starts, even in the middle of a wait', async () => {
    vi.useFakeTimers();
    const { worker, engine } = workerWith([]);
    worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(500);
    await worker.beforeApplicationShutdown();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(engine.processNext).toHaveBeenCalledTimes(1);
  });
});
