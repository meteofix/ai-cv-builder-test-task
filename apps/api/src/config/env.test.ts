import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './env.js';
import { databaseNames, resolveStream, WorktreeNotConfiguredError } from './worktree.js';

describe('loadConfig', () => {
  it('fails fast and names the missing key', () => {
    expect(() => loadConfig({ CV_STREAM: 'auth' })).toThrow(ConfigError);
    expect(() => loadConfig({ CV_STREAM: 'auth' })).toThrow(/ANTHROPIC_API_KEY is required/);
  });

  it('applies the defaults of the plan', () => {
    const config = loadConfig({ CV_STREAM: 'auth', ANTHROPIC_API_KEY: 'k' });
    expect(config).toMatchObject({
      LLM_CALL_BUDGET: 15,
      LLM_TIMEOUT_MS: 300_000,
      AUTHOR_MODEL: 'claude-opus-5-5',
      AUTHOR_EFFORT: 'medium',
      REVIEWER_MODEL: 'claude-opus-5-5',
      REVIEWER_EFFORT: 'medium',
      GENERATIONS_PER_USER_PER_DAY: 30,
      WORKER_ENABLED: true,
    });
  });
});

describe('worktree', () => {
  const linked = { isWorktree: true, root: '/w', mainRoot: '/m' };

  it('stops a linked worktree that has no stream', () => {
    expect(() => resolveStream(linked, {})).toThrow(WorktreeNotConfiguredError);
  });

  it('lets the main copy run without a stream', () => {
    expect(resolveStream({ ...linked, isWorktree: false }, {})).toBeUndefined();
  });

  it.each([
    ['auth', { dev: 'cv_dev_auth', test: 'cv_test_auth' }],
    ['pipeline', { dev: 'cv_dev_pipeline', test: 'cv_test_pipeline' }],
    ['web', { dev: 'cv_dev_web', test: 'cv_test_web' }],
    [undefined, { dev: 'cv', test: 'cv_test' }],
  ] as const)('database names of %s', (stream, expected) => {
    expect(databaseNames(stream)).toEqual(expected);
  });
});
