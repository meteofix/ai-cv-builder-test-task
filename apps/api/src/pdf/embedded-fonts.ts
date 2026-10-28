import type { FontFile } from '@cv/cv-template';
import { loadEmbeddedFonts } from '@cv/cv-template/node';
import type { FactoryProvider } from '@nestjs/common';

/** Injection token of the font files (base64) the PDF page embeds. Tests replace it with broken data. */
export const EMBEDDED_FONTS = Symbol('EMBEDDED_FONTS');
export type EmbeddedFonts = Readonly<Record<FontFile, string>>;

/** Read once per process: the files do not change and every render embeds them. */
export const embeddedFontsProvider: FactoryProvider<EmbeddedFonts> = {
  provide: EMBEDDED_FONTS,
  useFactory: loadEmbeddedFonts,
};
