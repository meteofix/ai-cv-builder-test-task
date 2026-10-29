import { existsSync } from 'node:fs';
import { LIMITS } from '@cv/shared';
import { z } from 'zod';
import { LLM_EFFORTS } from '../llm/llm-transport.js';
import { detectWorktree, resolveStream, STREAMS } from './worktree.js';

const flag = z.enum(['true', 'false']).transform((value) => value === 'true');
const port = z.coerce.number().int().min(1).max(65535);
const positiveInt = z.coerce.number().int().positive();

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: port.default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Proxy addresses or keywords (`loopback`, `uniquelocal`, CIDR). Fastify 5.12+ trusts no proxy for a hop count.
  TRUST_PROXY: z.string().default('loopback,linklocal,uniquelocal'),

  ANTHROPIC_API_KEY: z
    .string({ error: 'ANTHROPIC_API_KEY is required' })
    .min(1, 'ANTHROPIC_API_KEY is required'),
  AUTHOR_MODEL: z.string().default('claude-opus-5-5'),
  AUTHOR_EFFORT: z.enum(LLM_EFFORTS).default('medium'),
  REVIEWER_MODEL: z.string().default('claude-opus-5-5'),
  // The reviewer at low effort found as much as at medium and was not worse in the pairwise eval (decision 039).
  REVIEWER_EFFORT: z.enum(LLM_EFFORTS).default('low'),
  // The author writes a whole CV in one answer; on a long CV that takes minutes, not seconds.
  LLM_TIMEOUT_MS: positiveInt.default(300_000),
  LLM_CALL_BUDGET: positiveInt.default(15),

  GENERATIONS_PER_USER_PER_DAY: positiveInt.default(30),
  GENERATIONS_TOTAL: positiveInt.default(300),
  WORKER_ENABLED: flag.default(true),

  COOKIE_SECURE: flag.default(false),
  SESSION_TTL_DAYS: positiveInt.default(30),
  AUTH_RATE_LIMIT_PER_MINUTE: positiveInt.default(10),
  MAX_UPLOAD_BYTES: positiveInt.default(LIMITS.maxPdfBytes),

  DB_HOST: z.string().default('localhost'),
  DB_PORT: port.default(5432),
  DB_USER: z.string().default('cv'),
  DB_PASSWORD: z.string().default('cv'),
  DB_NAME: z.string().default('cv'),
  TEST_DB_NAME: z.string().optional(),

  CV_STREAM: z.enum(STREAMS).optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

/** Reads `.env` from the repository root when it exists; variables already set in the environment win. */
export function loadEnvFile(): void {
  const file = new URL('../../../../.env', import.meta.url);
  if (existsSync(file)) process.loadEnvFile(file);
}

export class ConfigError extends Error {}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  // Stops a worktree that was never set up before it can touch the databases of the main copy.
  resolveStream(detectWorktree(), source);
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`,
    );
    throw new ConfigError(`Invalid configuration:\n${lines.join('\n')}\nSee .env.example.`);
  }
  return parsed.data;
}
