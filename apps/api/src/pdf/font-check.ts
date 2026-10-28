/**
 * Runs inside the page. Every declared face is loaded explicitly: a face with a `unicode-range` the page
 * does not use is never loaded on its own. `document.fonts.check()` would not do, it returns true when no
 * face of the family is declared at all.
 */
export const FONT_CHECK_SCRIPT = `(async () => {
  await Promise.allSettled([...document.fonts].map((face) => face.load()));
  await document.fonts.ready;
  const faces = [...document.fonts].filter((face) => face.family.replace(/["']/g, '') === 'IBM Plex Sans');
  return { declared: faces.length, loaded: faces.filter((face) => face.status === 'loaded').length };
})()`;

/** Three weights, each in Latin and Cyrillic. */
export const EXPECTED_FONT_FACES = 6;

export interface FontCheckResult {
  declared: number;
  loaded: number;
}

export class FontCheckError extends Error {
  constructor(result: FontCheckResult) {
    super(
      `IBM Plex Sans: ${result.loaded} of ${result.declared} faces loaded, ${EXPECTED_FONT_FACES} expected`,
    );
  }
}

export function assertFontsLoaded(result: FontCheckResult): void {
  if (result.declared !== EXPECTED_FONT_FACES || result.loaded !== EXPECTED_FONT_FACES) {
    throw new FontCheckError(result);
  }
}
