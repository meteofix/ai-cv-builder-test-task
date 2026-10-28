import { homedir, tmpdir } from 'node:os';
import { dirname, resolve, sep } from 'node:path';
import { flattenCommands, type SimpleCommand } from './shell.ts';

/** Rules for Bash tool calls. Best effort: the aim is to stop mistakes and obvious workarounds, not a determined shell. */

export interface BashContext {
  /** True in a linked git worktree: the user alone changes `main` and the dependencies. */
  inWorktree: boolean;
  cwd: string;
  projectRoot: string;
  /** The main copy of the repository when `inWorktree`. */
  mainRoot?: string;
}

const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
/** Git subcommands that change the repository or its working tree. */
const GIT_MUTATING = new Set([
  'commit', 'merge', 'reset', 'checkout', 'switch', 'rebase', 'cherry-pick', 'revert', 'stash', 'tag', 'add', 'rm', 'mv', 'restore', 'clean', 'pull', 'am', 'apply', 'branch', 'update-ref', 'fetch', 'push', 'worktree',
]); // prettier-ignore
const PM_CHANGES_DEPS: Record<string, readonly string[]> = {
  pnpm: ['add', 'remove', 'rm', 'uninstall', 'un', 'update', 'up', 'upgrade', 'link', 'unlink', 'import', 'patch', 'approve-builds'],
  npm: ['install', 'i', 'add', 'uninstall', 'remove', 'rm', 'update', 'up', 'link', 'dedupe'],
  yarn: ['add', 'remove', 'upgrade', 'up', 'link', 'unlink'],
}; // prettier-ignore
const TEMP_ROOTS = [tmpdir(), '/tmp', '/private/tmp', '/private/var/folders', '/var/folders'];

function inside(path: string, root: string): boolean {
  return path.startsWith(root + sep);
}

function subcommand(
  words: string[],
  valueOptions: ReadonlySet<string>,
): { name: string | undefined; args: string[] } {
  for (let i = 1; i < words.length; i++) {
    const word = words[i] ?? '';
    if (valueOptions.has(word)) i++;
    else if (!word.startsWith('-')) return { name: word, args: words.slice(i + 1) };
  }
  return { name: undefined, args: [] };
}

const refsMain = (word: string) => /(^|[:+/])(refs\/heads\/)?main$/.test(word);

/** The `-C <dir>` options in front of the git subcommand, applied in order. */
function gitDirectory(words: string[], cwd: string | undefined): string | undefined {
  let dir = cwd;
  for (let i = 1; i < words.length; i++) {
    const word = words[i] ?? '';
    if (word === '-C' && dir !== undefined) dir = resolve(dir, words[++i] ?? '');
    else if (GIT_VALUE_OPTIONS.has(word)) i++;
    else if (!word.startsWith('-')) break;
  }
  return dir;
}

function checkGit(words: string[], ctx: BashContext, cwd: string | undefined): string | undefined {
  const { name, args } = subcommand(words, GIT_VALUE_OPTIONS);
  if (name === 'push')
    return 'Blocked: agents never push (and never force); the user pushes from a terminal.';
  if (!ctx.inWorktree) return undefined;
  const reason = 'Blocked: main changes only from the main copy, after the user agrees.';
  if (name === 'update-ref' && args.some(refsMain)) return reason;
  if (name === 'branch' && args.some((arg) => arg === 'main' || arg === 'refs/heads/main'))
    return reason;
  if (
    (name === 'fetch' || name === 'pull') &&
    args.some((arg) => /:(refs\/heads\/)?main$/.test(arg))
  )
    return reason;
  if (name !== undefined && GIT_MUTATING.has(name) && ctx.mainRoot !== undefined) {
    const dir = gitDirectory(words, cwd);
    const touchesMainCopy =
      dir === undefined ||
      ((dir === ctx.mainRoot || inside(dir, ctx.mainRoot)) &&
        dir !== ctx.projectRoot &&
        !inside(dir, ctx.projectRoot));
    if (touchesMainCopy) return `${reason} (git ${name} would run in the main copy)`;
  }
  return undefined;
}

function checkPackageManager(words: string[]): string | undefined {
  const [manager = ''] = words;
  const blocked = PM_CHANGES_DEPS[manager];
  if (!blocked) return undefined;
  const { name, args } = subcommand(
    words,
    new Set(['-C', '--dir', '--filter', '-F', '--prefix', '--cwd']),
  );
  const reason = `Blocked: dependencies change only through the user (${manager} ${name ?? ''}). Ask first.`;
  if (name !== undefined && blocked.includes(name)) return reason;
  const installs = name === 'install' || name === 'i';
  if (manager === 'pnpm' && installs && !args.includes('--frozen-lockfile')) {
    return `${reason} Only \`pnpm install --frozen-lockfile\` is allowed here.`;
  }
  if (
    manager === 'yarn' &&
    (name === undefined || name === 'install') &&
    !args.some((arg) => /^--(frozen-lockfile|immutable)$/.test(arg))
  ) {
    return reason;
  }
  return undefined;
}

function checkRm(words: string[], ctx: BashContext, cwd: string | undefined): string | undefined {
  const recursive = words.some(
    (word) => /^--recursive$|^-[a-zA-Z]*[rR]/.test(word) && word.startsWith('-'),
  );
  if (!recursive) return undefined;
  for (const target of words.slice(1).filter((word) => !word.startsWith('-'))) {
    const expanded = target.replace(/^~(?=\/|$)/, homedir());
    if (/\$|`/.test(expanded))
      return `Blocked: rm -r with a variable path (${target}); write the path out.`;
    if (cwd === undefined && !expanded.startsWith('/'))
      return `Blocked: rm -r on a relative path after a cd to an unknown place (${target}).`;
    const resolved = resolve(cwd ?? '/', expanded);
    // Allowed: inside the working tree or inside a temp dir. Never the tree itself, a parent of it,
    // the home directory, a temp root, or everything inside one (`/tmp/*` wipes every session's scratch space).
    const holdsTheTree = [ctx.projectRoot, cwd].some(
      (root) => root !== undefined && (root === resolved || inside(root, resolved)),
    );
    const wipesTheTree =
      expanded.endsWith('*') && resolve(cwd ?? '/', dirname(expanded)) === ctx.projectRoot;
    const wipesATempRoot =
      expanded.endsWith('*') && TEMP_ROOTS.includes(resolve(cwd ?? '/', dirname(expanded)));
    // Only the project root is a safe place, not wherever a `cd` led: `cd .. && rm -rf x` must not pass.
    const allowed =
      inside(resolved, ctx.projectRoot) || TEMP_ROOTS.some((root) => inside(resolved, root));
    if (holdsTheTree || wipesTheTree || wipesATempRoot || !allowed || resolved === homedir()) {
      return `Blocked: rm -r on ${target} (outside the working tree, or the tree itself).`;
    }
  }
  return undefined;
}

function checkSimple(
  command: SimpleCommand,
  previous: SimpleCommand | undefined,
  ctx: BashContext,
  cwd: string | undefined,
): string | undefined {
  const [head = ''] = command.words;
  if (
    head === 'sudo' ||
    head.startsWith('mkfs') ||
    ['shutdown', 'reboot', 'halt', 'poweroff'].includes(head)
  ) {
    return `Blocked: ${head} is not available to agents.`;
  }
  if (head === 'dd' && command.words.some((word) => word.startsWith('of=/dev/')))
    return 'Blocked: dd to a device.';
  if (
    ['sh', 'bash', 'zsh'].includes(head) &&
    command.after === '|' &&
    previous &&
    ['curl', 'wget'].includes(previous.words[0] ?? '')
  ) {
    return 'Blocked: piping a download into a shell.';
  }
  if (head === 'rm') return checkRm(command.words, ctx, cwd);
  if (head === 'git') return checkGit(command.words, ctx, cwd);
  if (ctx.inWorktree) return checkPackageManager(command.words);
  return undefined;
}

export function checkBash(command: string, ctx: BashContext): string | undefined {
  const commands = flattenCommands(command);
  // `cd x && rm -rf y` resolves `y` against `x`; a cd to a computed place leaves the directory unknown.
  let cwd: string | undefined = ctx.cwd;
  for (const [index, entry] of commands.entries()) {
    const [head = '', target] = entry.words;
    if (head === 'cd' || head === 'pushd') {
      const known = target !== undefined && !/[$`]/.test(target) && target !== '-';
      cwd =
        known && cwd !== undefined
          ? resolve(cwd, target.replace(/^~(?=\/|$)/, homedir()))
          : undefined;
      continue;
    }
    if (head === 'popd') {
      cwd = undefined;
      continue;
    }
    const reason = checkSimple(entry, commands[index - 1], ctx, cwd);
    if (reason) return reason;
  }
  return undefined;
}
