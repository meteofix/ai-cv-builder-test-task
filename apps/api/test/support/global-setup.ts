import { ensureDatabase } from '../../src/db/ensure-database.js';
import type { AppConfig } from '../../src/config/env.js';
import { testConfig } from './test-config.js';

/**
 * Vitest 5.0.5 crashes while mapping the stack frames of an error thrown from a global setup and hides
 * its message. A stack that is just the message keeps the explanation readable.
 */
function stop(message: string, cause: unknown): never {
  const error = new Error(message, { cause });
  error.stack = message;
  throw error;
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  // A refused connection on both IPv4 and IPv6 arrives as an AggregateError with an empty message.
  if (error.message !== '') return error.message;
  return (error as { code?: string }).code ?? error.name;
}

/** Runs once before the e2e files: checks the worktree and Postgres, creates the test database if needed. */
export default async function setup(): Promise<void> {
  let config: AppConfig;
  try {
    config = testConfig();
  } catch (error) {
    return stop(describe(error), error);
  }
  try {
    await ensureDatabase(config);
  } catch (error) {
    return stop(
      `Postgres is not reachable at ${config.DB_HOST}:${config.DB_PORT} (${describe(error)}).\n` +
        'Start it with `docker compose up -d postgres` and run the tests again.',
      error,
    );
  }
}
