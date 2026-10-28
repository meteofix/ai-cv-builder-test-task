import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { FONT_FILES } from '@cv/cv-template';

const here = dirname(fileURLToPath(import.meta.url));
const fontsDir = join(here, '../../packages/cv-template/fonts');

/** Serves the template fonts at `/fonts/*` (dev) and copies them into the build, so the preview loads them from the same origin. */
function cvFonts(): Plugin {
  return {
    name: 'cv-fonts',
    configureServer(server) {
      server.middlewares.use('/fonts', (req, res, next) => {
        const file = FONT_FILES.find((name) => req.url === `/${name}`);
        if (!file) {
          next();
          return;
        }
        void readFile(join(fontsDir, file)).then((bytes) => {
          res.setHeader('content-type', 'font/woff2');
          res.end(bytes);
        }, next);
      });
    },
    async generateBundle() {
      for (const file of FONT_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: `fonts/${file}`,
          source: await readFile(join(fontsDir, file)),
        });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, join(here, '../..'), '');
  return {
    plugins: [react(), tailwindcss(), cvFonts()],
    server: {
      host: true,
      port: Number(env.VITE_PORT ?? 5173),
      proxy: { '/api': `http://localhost:${env.API_PORT ?? 3000}` },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['src/test/setup.ts'],
      css: false,
    },
  };
});
