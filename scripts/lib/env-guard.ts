import { basename } from 'node:path';
import { flattenCommands, parseCommands } from './shell.ts';

/**
 * Keeps agents away from `.env` files. This is a best-effort backstop next to the `deny` rule in
 * `.claude/settings.json`: a shell can always find another way to read a file, so secrets must also
 * stay out of anything an agent could reasonably open.
 */

/** `.env`, `.env.local`, `.env.production` ... but not `.env.example`. Case-insensitive: macOS is. */
export function isSecretEnvName(name: string): boolean {
  const lower = name.toLowerCase();
  return /^\.env(\..*)?$/.test(lower) && lower !== '.env.example';
}

/** A glob such as `.*`, `.e*`, `.?nv` or `.[e]nv` that the shell would expand to a secret file. */
function globReachesEnvFile(piece: string): boolean {
  if (!piece.startsWith('.') || !/[*?[]/.test(piece)) return false;
  const pattern = piece
    .replace(/[.+^${}()|\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  try {
    const regex = new RegExp(`^${pattern}$`, 'i');
    return ['.env', '.env.local', '.env.production'].some((name) => regex.test(name));
  } catch {
    // An unparsable bracket expression: block rather than guess.
    return true;
  }
}

function isSecretEnvPath(path: string | undefined): boolean {
  if (path === undefined) return false;
  const name = basename(path);
  return isSecretEnvName(name) || globReachesEnvFile(name);
}

const REASON =
  'Blocked: .env files hold secrets and are never read by agents. Use .env.example for the list of variables.';

/** Pieces of a word that could name a file: `cat<.env`, `open('.env')`, `--env-file=.env`, `{.env,x}` all contain `.env`. */
function wordPieces(word: string): string[] {
  return word.split(/[\s<>=:(),'"|;&{}]+/).map((piece) => basename(piece));
}

const READERS = new Set(['cat', 'grep', 'egrep', 'fgrep', 'head', 'tail', 'less', 'more', 'sed', 'awk', 'strings', 'xxd', 'od', 'nl', 'tac', 'cut', 'sort', 'bat']); // prettier-ignore

function isRecursiveGrep(args: string[]): boolean {
  return args.some(
    (arg) => /^--(dereference-)?recursive$/.test(arg) || /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(arg),
  );
}

/** Commands whose arguments do not name `.env` but that read or print it anyway. */
function checkIndirectReads(words: string[]): string | undefined {
  const [head = '', ...args] = words;
  if (['grep', 'egrep', 'fgrep'].includes(head) && isRecursiveGrep(args)) {
    const bounded = args.some((arg) => /^--(exclude|include)/.test(arg));
    const paths = args.filter((arg) => !arg.startsWith('-')).slice(1);
    const wholeTree =
      paths.length === 0 || paths.some((path) => ['.', './', '..', '~', '/'].includes(path));
    if (wholeTree && !bounded) {
      return `${REASON} A recursive grep over the whole tree reads them: name a subdirectory, add --exclude='.env*', or use rg (it respects .gitignore).`;
    }
  }
  if (head === 'rg' && args.some((arg) => /^-u+$|^--no-ignore|^--unrestricted$/.test(arg))) {
    return `${REASON} rg without .gitignore filtering would read them.`;
  }
  if (head === 'find') {
    const exec = args.findIndex((arg) => /^-(exec|execdir|ok|okdir)$/.test(arg));
    if (exec !== -1 && READERS.has(basename(args[exec + 1] ?? '')))
      return `${REASON} find -exec with a reader command.`;
  }
  const compose = head === 'docker-compose' || (head === 'docker' && args[0] === 'compose');
  if (
    (compose && args.includes('config')) ||
    (head === 'docker' && ['inspect', 'config'].includes(args[0] ?? ''))
  ) {
    return `${REASON} This command prints resolved environment values, the API key included.`;
  }
  if (
    head === 'printenv' &&
    (args.filter((arg) => !arg.startsWith('-')).length === 0 || args.includes('ANTHROPIC_API_KEY'))
  ) {
    return `${REASON} Do not dump the environment or print the API key.`;
  }
  if (
    ['export', 'declare', 'typeset'].includes(head) &&
    args.every((arg) => /^-[a-zA-Z]*[px][a-zA-Z]*$/.test(arg))
  ) {
    return `${REASON} Do not dump the environment.`;
  }
  if (head === 'set' && args.length === 0) return `${REASON} Do not dump the environment.`;
  return undefined;
}

function checkBareEnv(command: string): string | undefined {
  for (const { words } of parseCommands(command)) {
    const rest = words.filter((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
    if (
      basename(rest[0] ?? '') === 'env' &&
      rest.slice(1).every((word) => word.startsWith('-') || !word.trim())
    ) {
      return `${REASON} Do not dump the environment.`;
    }
  }
  return undefined;
}

export function checkEnvAccess(tool: string, input: Record<string, unknown>): string | undefined {
  if (tool === 'Read') {
    return isSecretEnvPath(asString(input.file_path)) ? REASON : undefined;
  }
  if (tool === 'Grep') {
    return [asString(input.path), asString(input.glob)].some(isSecretEnvPath) ? REASON : undefined;
  }
  if (tool !== 'Bash') return undefined;

  const command = asString(input.command) ?? '';
  if (/\$\{?ANTHROPIC_API_KEY/.test(command)) return `${REASON} Do not expand the API key.`;
  const bare = checkBareEnv(command);
  if (bare) return bare;
  for (const { words } of flattenCommands(command)) {
    if (
      words.some((word) =>
        wordPieces(word).some((piece) => isSecretEnvName(piece) || globReachesEnvFile(piece)),
      )
    ) {
      return REASON;
    }
    const indirect = checkIndirectReads(words);
    if (indirect) return indirect;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
