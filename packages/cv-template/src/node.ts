import { readFile } from 'node:fs/promises';
import { FONT_FILES, type FontFile } from './fonts.js';

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
