/** The IBM Plex Sans files shipped in `fonts/` (OFL, see fonts/OFL.txt). */
export const FONT_FILES = [
  'ibm-plex-sans-latin-400-normal.woff2',
  'ibm-plex-sans-latin-500-normal.woff2',
  'ibm-plex-sans-latin-600-normal.woff2',
  'ibm-plex-sans-cyrillic-400-normal.woff2',
  'ibm-plex-sans-cyrillic-500-normal.woff2',
  'ibm-plex-sans-cyrillic-600-normal.woff2',
] as const;

export type FontFile = (typeof FONT_FILES)[number];

/**
 * Where the template gets its fonts:
 * - `baseUrl` — the preview loads them from the same origin (`${baseUrl}/<file>`);
 * - `embedded` — the PDF page has no network, so every file is inlined as base64.
 */
export type FontSource = { baseUrl: string } | { embedded: Readonly<Record<FontFile, string>> };

const LATIN_RANGE =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const CYRILLIC_RANGE = 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116';

function fileUrl(fonts: FontSource, file: FontFile): string {
  if ('embedded' in fonts) return `data:font/woff2;base64,${fonts.embedded[file]}`;
  return `${fonts.baseUrl.replace(/\/$/, '')}/${file}`;
}

export function fontFaceCss(fonts: FontSource): string {
  return FONT_FILES.map((file) => {
    const [, , script, weight] = /^(.+)-(latin|cyrillic)-(\d+)-normal\.woff2$/.exec(file) ?? [];
    const range = script === 'cyrillic' ? CYRILLIC_RANGE : LATIN_RANGE;
    return `@font-face{font-family:"IBM Plex Sans";font-style:normal;font-weight:${weight};font-display:block;src:url("${fileUrl(fonts, file)}") format("woff2");unicode-range:${range}}`;
  }).join('\n');
}
