import { loadConfig, loadEnvFile, type AppConfig } from '../../src/config/env.js';
import { databaseNames, detectWorktree, resolveStream } from '../../src/config/worktree.js';

/** Config for tests: the stream's test database (`cv_test`, `cv_test_<stream>`), a fake key and no background worker. */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  loadEnvFile();
  const stream = resolveStream(detectWorktree(), process.env);
  const dbName = process.env.TEST_DB_NAME ?? databaseNames(stream).test;
  if (!dbName.includes('_test')) {
    throw new Error(
      `Refusing to run tests against "${dbName}": a test database name must contain "_test".`,
    );
  }
  // Only the database coordinates and the stream come from the environment: a developer's settings file must
  // not change test behaviour (COOKIE_SECURE, limits, TRUST_PROXY ...).
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, CV_STREAM } = process.env;
  const config = {
    ...loadConfig({
      NODE_ENV: 'test',
      ANTHROPIC_API_KEY: 'test-key',
      DB_HOST,
      DB_PORT,
      DB_USER,
      DB_PASSWORD,
      DB_NAME: dbName,
      CV_STREAM,
      WORKER_ENABLED: 'false',
      LOG_LEVEL: 'silent',
      AUTH_RATE_LIMIT_PER_MINUTE: '1000',
    }),
    ...overrides,
  };
  if (!config.DB_NAME.includes('_test')) {
    throw new Error(
      `Refusing to run tests against "${config.DB_NAME}": a test database name must contain "_test".`,
    );
  }
  return config;
}
