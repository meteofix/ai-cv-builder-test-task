/**
 * Rules behind the Claude hooks. Every check returns the reason to block, or `undefined` to allow.
 * Hooks are the only protection in a session that runs without permission prompts, and they are a
 * best-effort backstop: a shell can always find another way.
 */
export { checkBash, type BashContext } from './bash-guard.ts';
export { checkEdit, type StreamState } from './edit-guard.ts';
export { checkEnvAccess, isSecretEnvName } from './env-guard.ts';
