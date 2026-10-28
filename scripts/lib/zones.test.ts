import { describe, expect, it } from 'vitest';
import { isAllowed } from './zones.ts';

describe('isAllowed', () => {
  it.each([
    // [stream, file, allowed]
    ['auth', 'apps/api/src/auth/auth.service.ts', true],
    ['auth', 'apps/api/src/cvs/cvs.controller.ts', true],
    ['auth', 'apps/api/src/pdf/pdf.service.ts', true],
    ['auth', 'apps/api/test/cvs.e2e-spec.ts', true],
    ['auth', 'apps/api/test/cvs/fixtures/scan.pdf', true],
    ['auth', 'docs/specs/auth.md', true],
    ['auth', 'docs/specs/generation.md', false],
    ['auth', 'apps/api/src/generation/job.ts', false],
    ['auth', 'apps/api/src/common/guard.ts', false],
    ['auth', 'apps/api/src/main.ts', false],
    ['auth', 'apps/api/test/support/global-setup.ts', false],
    ['auth', 'apps/api/test/generation.e2e-spec.ts', false],
    ['auth', 'packages/shared/src/document.ts', false],
    ['auth', 'package.json', false],
    ['auth', 'pnpm-lock.yaml', false],
    ['auth', '.claude/settings.json', false],
    ['auth', 'AGENTS.md', false],
    ['pipeline', 'apps/api/src/grounding/quotes.ts', true],
    ['pipeline', 'apps/api/src/llm/llm.client.ts', true],
    ['pipeline', 'apps/api/test/grounding.acceptance.spec.ts', true],
    ['pipeline', 'docs/specs/grounding.md', true],
    ['pipeline', 'docs/specs/cvs.md', false],
    ['pipeline', 'apps/api/src/cvs/cvs.service.ts', false],
    ['web', 'apps/web/src/App.tsx', true],
    ['web', 'apps/web/src/test/setup.ts', true],
    ['web', 'apps/web/public/mockServiceWorker.js', true],
    ['web', 'apps/web/vite.config.ts', false],
    ['web', 'apps/web/package.json', false],
    ['web', 'apps/web/tsconfig.json', false],
    ['web', 'apps/web/nginx.conf', false],
    ['web', 'packages/cv-template/src/render.tsx', true],
    ['web', 'packages/cv-template/src/styles.ts', true],
    ['web', 'packages/cv-template/test/ats.test.ts', true],
    ['web', 'packages/cv-template/src/pdf-options.ts', false],
    ['web', 'packages/cv-template/src/index.ts', false],
    ['web', 'packages/cv-template/package.json', false],
    ['web', 'packages/cv-template/fonts/OFL.txt', false],
    ['web', 'docs/specs/web.md', true],
    ['web', 'apps/web/index.html', true],
    ['web', 'apps/web/AGENTS.md', false],
    ['web', 'apps/web/vite.config.js', false],
    ['web', 'apps/web/Vite.config.ts', false],
    ['web', 'apps/web/Package.json', false],
    ['web', 'apps/web/.npmrc', false],
    ['web', 'apps/web/SRC/App.tsx', true],
    ['web', 'packages/cv-template/src/node.ts', false],
    ['web', 'packages/cv-template/src/fonts.ts', false],
    ['web', 'packages/cv-template/src/Index.ts', false],
    ['web', 'packages/cv-template/src/labels.ts', true],
    ['web', 'apps/api/src/auth/auth.module.ts', false],
    ['auth', 'apps/api/src/auth/../common/guard.ts', false],
    ['auth', '../outside.ts', false],
  ] as const)('%s may change %s: %s', (stream, file, allowed) => {
    expect(isAllowed(stream, file)).toBe(allowed);
  });

  it('lets the main copy change anything', () => {
    expect(isAllowed(undefined, 'packages/shared/src/document.ts')).toBe(true);
  });
});
