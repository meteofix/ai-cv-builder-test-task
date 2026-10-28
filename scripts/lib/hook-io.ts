import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isStream,
  resolveStream,
  WorktreeNotConfiguredError,
  type WorktreeInfo,
} from '../../apps/api/src/config/worktree.ts';
import type { StreamState } from './guards.ts';

export interface HookInput {
  cwd?: string;
  stop_hook_active?: boolean;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

export async function readHookInput(): Promise<HookInput> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? (JSON.parse(text) as HookInput) : {};
}

/** Exit code 2 blocks the tool call and shows the message to the agent. */
export function block(reason: string): never {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

/** Runs a guard and fails closed: a crash in a guard must not silently let the tool call through. */
export async function guard(body: (input: HookInput) => void | Promise<void>): Promise<void> {
  try {
    await body(await readHookInput());
  } catch (error) {
    block(
      `Hook failed (${error instanceof Error ? error.message : String(error)}); the call is blocked to be safe.`,
    );
  }
}

function streamFromFiles(root: string): string | undefined {
  const settings = join(root, '.claude', 'settings.local.json');
  if (existsSync(settings)) {
    const env = (JSON.parse(readFileSync(settings, 'utf8')) as { env?: Record<string, string> })
      .env;
    if (env?.CV_STREAM) return env.CV_STREAM;
  }
  const dotenv = join(root, '.env');
  if (existsSync(dotenv)) {
    const line = readFileSync(dotenv, 'utf8')
      .split('\n')
      .find((entry) => entry.startsWith('CV_STREAM='));
    if (line) return line.slice('CV_STREAM='.length).trim();
  }
  return undefined;
}

/** The stream of this checkout: the session environment first, then the files `pnpm worktree:init` wrote. */
export function streamState(info: WorktreeInfo): StreamState {
  const fromEnv = process.env.CV_STREAM;
  const value = isStream(fromEnv) ? fromEnv : streamFromFiles(info.root);
  if (isStream(value)) return { kind: 'stream', stream: value };
  try {
    resolveStream(info, { CV_STREAM: value });
  } catch (error) {
    if (error instanceof WorktreeNotConfiguredError) return { kind: 'unconfigured' };
    throw error;
  }
  return { kind: 'main' };
}
