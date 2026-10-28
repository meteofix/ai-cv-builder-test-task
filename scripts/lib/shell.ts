import { basename } from 'node:path';

/**
 * A small quote-aware splitter: enough to find the commands inside a Bash tool call, not a shell.
 * It is a best-effort backstop for the hooks; it cannot see through every construct a shell allows.
 */

export interface SimpleCommand {
  words: string[];
  /** The operator right before this command: `|` means its input is the previous command's output. */
  after: ';' | '&&' | '||' | '|' | '&' | undefined;
}

const SEPARATORS = new Set([';', '&', '|', '\n', '(', ')', '`']);
/** Commands that only write their heredoc into a file: for them the body is text, not code. */
const TEXT_CONSUMERS = new Set(['cat', 'tee']);

function firstWord(words: string[]): string | undefined {
  return words.find((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
}

export function parseCommands(source: string): SimpleCommand[] {
  // Bash drops a backslash-newline before it splits words.
  const input = source.replace(/\\\n/g, '');
  const commands: SimpleCommand[] = [];
  let words: string[] = [];
  let word = '';
  let hasWord = false;
  let quote: '"' | "'" | undefined;
  let after: SimpleCommand['after'];

  const endWord = () => {
    if (hasWord) words.push(word);
    word = '';
    hasWord = false;
  };
  const endCommand = (operator: SimpleCommand['after']) => {
    endWord();
    if (words.length > 0) commands.push({ words, after });
    words = [];
    after = operator;
  };

  // The body of `cat <<'EOF'` or `tee <<'EOF'` is literal text. Any other consumer (an interpreter, a
  // shell, a pipe into one) runs it, so such bodies are parsed like ordinary commands.
  const heredocs: { delimiter: string; stripTabs: boolean }[] = [];

  for (let i = 0; i < input.length; i++) {
    const char = input.charAt(i);
    if (!quote && char === '<' && input.charAt(i + 1) === '<' && input.charAt(i + 2) !== '<') {
      const opener = /^<<(-?)\s*(['"])([^'"\n]+)\2/.exec(input.slice(i));
      if (opener?.[3] !== undefined) {
        const lineEnd = input.indexOf('\n', i);
        const rest = input.slice(i + opener[0].length, lineEnd === -1 ? input.length : lineEnd);
        const consumer = firstWord([...words, ...(hasWord ? [word] : [])]);
        const literal =
          consumer !== undefined && TEXT_CONSUMERS.has(basename(consumer)) && !/[|;&]/.test(rest);
        if (literal) heredocs.push({ delimiter: opener[3], stripTabs: opener[1] === '-' });
        i += opener[0].length - 1;
        word += opener[0];
        hasWord = true;
        endWord();
        continue;
      }
    }
    if (!quote && char === '\n' && heredocs.length > 0) {
      for (const { delimiter, stripTabs } of heredocs.splice(0)) {
        for (;;) {
          const end = input.indexOf('\n', i + 1);
          const line = input.slice(i + 1, end === -1 ? input.length : end);
          i = end === -1 ? input.length : end;
          if ((stripTabs ? line.replace(/^\t+/, '') : line) === delimiter || end === -1) break;
        }
      }
      endCommand(';');
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      else if (char === '\\' && quote === '"' && i + 1 < input.length) word += input.charAt(++i);
      else word += char;
      continue;
    }
    if (char === '\\' && i + 1 < input.length) {
      word += input.charAt(++i);
      hasWord = true;
    } else if (char === '"' || char === "'") {
      quote = char;
      hasWord = true;
    } else if (char === '$' && input.charAt(i + 1) === '(') {
      endCommand(';');
      i++;
    } else if (SEPARATORS.has(char)) {
      const next = input.charAt(i + 1);
      if (char === '&' && next === '&') {
        endCommand('&&');
        i++;
      } else if (char === '|' && next === '|') {
        endCommand('||');
        i++;
      } else if (char === '|' || char === '&' || char === ';') {
        endCommand(char);
      } else {
        endCommand(';');
      }
    } else if (/\s/.test(char)) {
      endWord();
    } else {
      word += char;
      hasWord = true;
    }
  }
  endCommand(undefined);
  return commands;
}

/** Shell keywords and commands that only run what follows them. `sudo` is deliberately not here. */
const PASS_THROUGH = new Set([
  'if', 'then', 'else', 'elif', 'while', 'until', 'do', '!', '{', 'time', 'command', 'builtin', 'exec', 'nohup',
]); // prettier-ignore
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);
/** Options that take a value, per wrapper. */
const ENV_VALUE_OPTIONS = new Set(['-u', '-C', '-S', '--unset', '--chdir', '--split-string']);
const NICE_VALUE_OPTIONS = new Set(['-n', '--adjustment']);
const TIMEOUT_VALUE_OPTIONS = new Set(['-s', '-k', '--signal', '--kill-after']);
const XARGS_VALUE_OPTIONS = new Set(['-n', '-I', '-P', '-L', '-d', '-E', '-s', '-a', '-R', '-S']);

function skipAssignments(words: string[]): string[] {
  const index = words.findIndex((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
  return index === -1 ? [] : words.slice(index);
}

function skipOptions(words: string[], withValue: ReadonlySet<string>): string[] {
  let index = 0;
  while (words[index]?.startsWith('-') && words[index] !== '-') {
    index += withValue.has(words[index] ?? '') ? 2 : 1;
  }
  return words.slice(index);
}

/** The command that really runs: assignments, keywords and wrappers (`env`, `nice`, `timeout`) removed, head as a bare name. */
function realCommand(input: string[]): string[] {
  let words = skipAssignments(input);
  for (;;) {
    const name = basename(words[0] ?? '');
    if (PASS_THROUGH.has(name)) words = skipAssignments(words.slice(1));
    else if (name === 'env')
      words = skipAssignments(skipOptions(words.slice(1), ENV_VALUE_OPTIONS));
    else if (name === 'nice') words = skipOptions(words.slice(1), NICE_VALUE_OPTIONS);
    else if (name === 'timeout')
      words = skipOptions(words.slice(1), TIMEOUT_VALUE_OPTIONS).slice(1);
    else break;
  }
  const [head, ...rest] = words;
  return head === undefined ? [] : [basename(head), ...rest];
}

/** Every simple command in the input, including those inside `bash -c "..."`, `eval "..."` and after `xargs`. */
export function flattenCommands(input: string, depth = 0): SimpleCommand[] {
  const result: SimpleCommand[] = [];
  for (const command of parseCommands(input)) {
    const words = realCommand(command.words);
    const [head, ...rest] = words;
    if (head === undefined) continue;
    result.push({ words, after: command.after });
    if (depth >= 4) continue;
    if (SHELLS.has(head)) {
      const flag = rest.findIndex((word) => /^-[a-z]*c[a-z]*$/.test(word));
      const script = flag === -1 ? undefined : rest[flag + 1];
      if (script !== undefined) result.push(...flattenCommands(script, depth + 1));
    } else if (head === 'eval') {
      result.push(...flattenCommands(rest.join(' '), depth + 1));
    } else if (head === 'xargs') {
      const inner = skipOptions(rest, XARGS_VALUE_OPTIONS);
      if (inner.length > 0) result.push(...flattenCommands(inner.join(' '), depth + 1));
    }
  }
  return result;
}
