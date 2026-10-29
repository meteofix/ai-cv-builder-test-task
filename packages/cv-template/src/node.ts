import { readFile } from 'node:fs/promises';
import { FONT_FILES, type FontFile } from './fonts.js';
import { PAGE_CONTENT_HEIGHT_PX, PAGE_CONTENT_WIDTH_PX } from './page.js';
import { paginate } from './paginate.js';

/** Node only: reads the font files for the PDF renderer. Kept out of the main entry so the web bundle stays browser-safe. */
export async function loadEmbeddedFonts(): Promise<Record<FontFile, string>> {
  const entries = await Promise.all(
    FONT_FILES.map(async (file) => {
      const bytes = await readFile(new URL(`../fonts/${file}`, import.meta.url));
      return [file, bytes.toString('base64')] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<FontFile, string>;
}

/** The part of a Playwright page `placePageBreaks` uses, so this package needs no Playwright at run time. */
interface PrintPage {
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  emulateMedia(options: { media: 'print' }): Promise<void>;
  evaluate<Arg>(pageFunction: (arg: Arg) => void, arg: Arg): Promise<void>;
}

/**
 * Node only: places the PDF's page breaks before `page.pdf()` (`paginate`). The CV is measured at the
 * printed width (rounded down, so lines wrap no later than in print) with the print rules applied.
 */
export async function placePageBreaks(page: PrintPage): Promise<void> {
  await page.setViewportSize({ width: Math.floor(PAGE_CONTENT_WIDTH_PX), height: 1000 });
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(paginate, PAGE_CONTENT_HEIGHT_PX);
}
