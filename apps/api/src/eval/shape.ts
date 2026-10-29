import { bulletsOf, type CvDocument } from '@cv/shared';
import { renderCvHtml } from '@cv/cv-template';
import { loadEmbeddedFonts } from '@cv/cv-template/node';
import pino from 'pino';
import { getDocumentProxy } from 'unpdf';
import { PdfRenderer } from '../pdf/pdf-renderer.service.js';

/**
 * The shape of a generated CV for the eval (decision 036): pages of the real PDF, bullet lengths, groups
 * and summary length. Measured, never enforced: the product only shows the page count.
 */

/** About two printed lines of a bullet in the template; longer ones are counted. */
export const LONG_BULLET_CHARS = 220;

// Letters and digits only, so a heading's case, spacing or decoration does not hide a match.
const normalized = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

export interface Shape {
  bullets: number;
  medianChars: number;
  maxChars: number;
  long: number;
  summaryChars: number;
  /** Titled groups of positions and entries, and those whose title is not a line of the source. */
  titledGroups: number;
  inventedTitles: string[];
  entries: number;
}

export function shapeOf(document: CvDocument, source: string): Shape {
  const lengths = document.experience
    .flatMap((position) => bulletsOf(position).map((bullet) => bullet.text.length))
    .sort((a, b) => a - b);
  const titles = [
    ...document.experience.flatMap((position) => position.groups),
    ...document.additional.flatMap((section) => section.entries.flatMap((entry) => entry.groups)),
  ].flatMap((group) => (group.title ? [group.title] : []));
  const text = normalized(source);
  return {
    bullets: lengths.length,
    medianChars: lengths[Math.floor(lengths.length / 2)] ?? 0,
    maxChars: lengths.at(-1) ?? 0,
    long: lengths.filter((length) => length > LONG_BULLET_CHARS).length,
    summaryChars: document.summary.text.length,
    titledGroups: titles.length,
    inventedTitles: titles.filter((title) => !text.includes(normalized(title))),
    entries: document.additional.reduce((sum, section) => sum + section.entries.length, 0),
  };
}

/** Pages of the CV printed the way the product prints it (same template, fonts and PDF options). */
export async function pdfPager() {
  const renderer = new PdfRenderer(pino({ level: 'silent' }));
  const fonts = await loadEmbeddedFonts();
  return {
    pages: async (document: CvDocument) => {
      const bytes = await renderer.render(renderCvHtml(document, { fonts: { embedded: fonts } }));
      return (await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 })).numPages;
    },
    close: () => renderer.onModuleDestroy(),
  };
}
