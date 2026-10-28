import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Nest relies on decorator metadata, which esbuild/oxc do not emit, so SWC compiles the sources.
const plugins = [swc.vite({ module: { type: 'es6' } })];

export default defineConfig({
  test: {
    projects: [
      {
        plugins,
        test: { name: 'unit', include: ['src/**/*.test.ts'] },
      },
      {
        plugins,
        test: {
          name: 'e2e',
          include: ['test/**/*.e2e-spec.ts', 'test/**/*.acceptance.spec.ts'],
          globalSetup: ['test/support/global-setup.ts'],
          // One real Postgres database per stream: files run one after another.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
