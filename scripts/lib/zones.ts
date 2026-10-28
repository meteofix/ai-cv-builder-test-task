import { posix } from 'node:path';
import type { Stream } from '../../apps/api/src/config/worktree.ts';

/**
 * Who may change which file. One table for the Edit|Write hook and for `pnpm zone:check`, so both agree.
 * The main copy (no stream) may change everything; a stream may change only its own area.
 */

const API_MODULES: Record<Exclude<Stream, 'web'>, readonly string[]> = {
  auth: ['auth', 'cvs', 'sources', 'pdf'],
  pipeline: ['generation', 'grounding', 'llm'],
};

const SPECS: Record<Stream, readonly string[]> = {
  auth: ['auth', 'cvs', 'pdf'],
  pipeline: ['generation', 'grounding'],
  web: ['web', 'cv-template'],
};

/** The template's public entry point, the frozen PDF options, the Node-only entry and the font contract. */
const TEMPLATE_MAIN_ONLY = new Set([
  'src/index.ts',
  'src/pdf-options.ts',
  'src/node.ts',
  'src/fonts.ts',
]);

/** `apps/api/test/cvs.e2e-spec.ts` and `apps/api/test/cvs/fixtures/a.pdf` both belong to the module `cvs`. */
function apiTestModule(rest: string): string {
  return rest.split(/[./]/)[0] ?? '';
}

/** `file` is a path relative to the repository root, with forward slashes. */
export function isAllowed(stream: Stream | undefined, file: string): boolean {
  if (stream === undefined) return true;
  // Lower case: the default macOS file system treats `Vite.config.ts` and `vite.config.ts` as one file.
  const path = posix.normalize(file).toLowerCase();
  if (path.startsWith('../')) return false;

  if (stream !== 'web') {
    const modules = API_MODULES[stream];
    const src = /^apps\/api\/src\/([^/]+)\//.exec(path)?.[1];
    if (src && modules.includes(src)) return true;
    const test = /^apps\/api\/test\/(.+)$/.exec(path)?.[1];
    if (test && modules.includes(apiTestModule(test))) return true;
  }

  const spec = /^docs\/specs\/([^/]+)\.md$/.exec(path)?.[1];
  if (spec && SPECS[stream].includes(spec)) return true;

  if (stream === 'web') {
    // An allow-list: build and container config (package.json, vite/vitest config, tsconfig, Dockerfile,
    // nginx, AGENTS.md ...) is not listed, so it stays with the user.
    if (/^apps\/web\/(src|public)\/./.test(path) || path === 'apps/web/index.html') return true;
    const template = /^packages\/cv-template\/((?:src|test)\/.+)$/.exec(path)?.[1];
    if (template) return !TEMPLATE_MAIN_ONLY.has(template);
  }
  return false;
}
