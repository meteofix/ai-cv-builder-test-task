import { Injectable } from '@nestjs/common';

/**
 * The time every lease, backoff and claim of the job engine is computed from. Tests replace it to move
 * past `run_after` without waiting; the database's `now()` is never used for these decisions.
 */
export abstract class Clock {
  abstract now(): Date;
}

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
