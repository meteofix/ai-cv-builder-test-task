import 'reflect-metadata';
import { createApp } from './bootstrap.js';
import { ConfigError, loadConfig, loadEnvFile } from './config/env.js';
import { WorktreeNotConfiguredError } from './config/worktree.js';
import { createLogger } from './config/logger.js';

loadEnvFile();

let config;
try {
  config = loadConfig();
} catch (error) {
  // The logger needs a valid config, so a bad config is the one thing printed to stderr directly.
  if (error instanceof ConfigError || error instanceof WorktreeNotConfiguredError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  throw error;
}

const logger = createLogger(config);
const app = await createApp(config, logger);
// Without this SIGTERM kills the process before the worker and Chromium stop cleanly.
app.enableShutdownHooks();
await app.listen(config.API_PORT, config.API_HOST);
logger.info({ port: config.API_PORT, stream: config.CV_STREAM ?? 'main' }, 'API listening');
