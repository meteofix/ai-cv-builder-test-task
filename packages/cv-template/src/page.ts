/**
 * The printed page. `PDF_OPTIONS` asks for A4 and leaves the margin to the template's `@page` rule, so
 * this margin is the one the PDF gets; the preview pads its page by the same amount.
 */
export const PAGE_MARGIN_MM = 17;

const A4_HEIGHT_MM = 297;
const CSS_PX_PER_MM = 96 / 25.4;

/**
 * The height of the printable area of one PDF page in CSS pixels (A4 less the top and bottom margins,
 * about 994 px). The editor divides the preview's content height by it to show how many pages the PDF has.
 */
export const PAGE_CONTENT_HEIGHT_PX = (A4_HEIGHT_MM - 2 * PAGE_MARGIN_MM) * CSS_PX_PER_MM;

const A4_WIDTH_MM = 210;

/** The width of the printable area in CSS pixels: the CV is measured at it before `paginate`. */
export const PAGE_CONTENT_WIDTH_PX = (A4_WIDTH_MM - 2 * PAGE_MARGIN_MM) * CSS_PX_PER_MM;
