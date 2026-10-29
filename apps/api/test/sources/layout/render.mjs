// Re-rendering changes the bytes (Chromium stamps a creation date), so tests never compare hashes.
// Renders every fixture `*.html` in this folder to a PDF next to it with Chromium:
// `node apps/api/test/sources/layout/render.mjs`. The PDFs are committed, so tests do not depend on this.
import { readdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const dir = new URL('./', import.meta.url);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const name of (await readdir(dir)).filter((file) => file.endsWith('.html'))) {
    await page.goto(new URL(name, dir).href);
    await page.pdf({
      path: new URL(name.replace(/\.html$/, '.pdf'), dir).pathname,
      preferCSSPageSize: true,
      printBackground: true,
    });
  }
} finally {
  await browser.close();
}
