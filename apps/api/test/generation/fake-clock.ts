import { Clock } from '../../src/generation/clock.js';

/**
 * A clock the test moves by hand. It starts a little ahead of the wall clock, so jobs a factory creates
 * during the test (with `run_after = new Date()`) are already due.
 */
export class FakeClock extends Clock {
  private current = new Date(Date.now() + 5_000);

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  reset(): void {
    this.current = new Date(Date.now() + 5_000);
  }
}
