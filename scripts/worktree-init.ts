import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  databaseNames,
  detectWorktree,
  isStream,
  STREAMS,
  type Stream,
} from '../apps/api/src/config/worktree.ts';

// Usage: pnpm worktree:init <auth|pipeline|web>
// Sets up a fresh linked git worktree: .env (ports, databases of the stream), .claude/settings.local.json
// (CV_STREAM for hooks), dependencies and the built workspace packages. Safe to run again, asks nothing.

const PORTS: Record<Stream, { api: number; vite: number }> = {
  auth: { api: 3101, vite: 5201 },
  pipeline: { api: 3102, vite: 5202 },
  web: { api: 3103, vite: 5203 },
};

// Connection settings and the key come from the main copy's .env, so every worktree uses the one Postgres.
const INHERITED = ['ANTHROPIC_API_KEY', 'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD'];

function parseEnv(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const entries = readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()))
    .flatMap((match) =>
      match?.[1] && match[2] !== undefined ? [[match[1], match[2]] as const] : [],
    );
  return Object.fromEntries(entries);
}

function run(cwd: string, command: string, args: string[]): void {
  console.log(`$ ${command} ${args.join(' ')}`);
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

const stream = process.argv[2];
if (!isStream(stream)) {
  console.error(`Usage: pnpm worktree:init <${STREAMS.join('|')}>`);
  process.exit(2);
}

const { isWorktree, root, mainRoot } = detectWorktree();
if (!isWorktree) {
  console.error('This is the main copy, not a linked git worktree: nothing to set up.');
  process.exit(1);
}

const inherited = parseEnv(join(mainRoot, '.env'));
const names = databaseNames(stream);
const env: Record<string, string | undefined> = {
  CV_STREAM: stream,
  API_PORT: String(PORTS[stream].api),
  VITE_PORT: String(PORTS[stream].vite),
  ...Object.fromEntries(INHERITED.map((key) => [key, inherited[key]])),
  DB_NAME: names.dev,
  TEST_DB_NAME: names.test,
};
const lines = Object.entries(env).flatMap(([key, value]) => (value ? [`${key}=${value}`] : []));
const envFile = join(root, '.env');
writeFileSync(envFile, `${lines.join('\n')}\n`);
chmodSync(envFile, 0o600); // `mode` of writeFileSync applies only when the file is created

const claudeDir = join(root, '.claude');
mkdirSync(claudeDir, { recursive: true });
const settingsFile = join(claudeDir, 'settings.local.json');
const settings = existsSync(settingsFile)
  ? (JSON.parse(readFileSync(settingsFile, 'utf8')) as { env?: Record<string, string> })
  : {};
writeFileSync(
  settingsFile,
  `${JSON.stringify({ ...settings, env: { ...settings.env, CV_STREAM: stream } }, null, 2)}\n`,
);

run(root, 'pnpm', ['install', '--frozen-lockfile']);
run(root, 'pnpm', ['build:packages']);

console.log(
  `\nWorktree set up for "${stream}": API :${PORTS[stream].api}, web :${PORTS[stream].vite}, ` +
    `tests on ${names.test}, dev data in ${names.dev}.\n` +
    'Restart the Claude session if it was already running: hooks read CV_STREAM at start.',
);
