/**
 * Options for Playwright's `page.pdf()`. The PDF endpoint and the template's ATS test both import
 * this constant, so the test checks exactly the file users download. Frozen: change it only with the user.
 */
export const PDF_OPTIONS = {
  format: 'A4',
  printBackground: true,
  tagged: true,
  // No margin option on purpose: the 17 mm page margin comes from `@page` in the template CSS.
} as const;
