import { Inject, Injectable } from '@nestjs/common';
import { renderCvHtml } from '@cv/cv-template';
import { ApiError } from '../common/api-error.js';
import { OwnedCvs } from '../common/owned-cvs.js';
import { EMBEDDED_FONTS, type EmbeddedFonts } from './embedded-fonts.js';
import { PdfRenderer } from './pdf-renderer.service.js';

/**
 * The page may not run scripts or fetch anything: the CV text is data from a user and the page is printed
 * by a browser running without its own sandbox. Our `page.evaluate` is not affected by the policy.
 */
const CSP =
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; font-src data:; img-src data:">';

export interface CvPdf {
  bytes: Buffer;
  fullName: string;
}

@Injectable()
export class PdfService {
  constructor(
    @Inject(OwnedCvs) private readonly owned: OwnedCvs,
    @Inject(PdfRenderer) private readonly renderer: PdfRenderer,
    @Inject(EMBEDDED_FONTS) private readonly fonts: EmbeddedFonts,
  ) {}

  /** The stored document as a PDF; a CV with an active job can still be downloaded, its document is complete. */
  async forCv(id: string, userId: string): Promise<CvPdf> {
    const cv = await this.owned.findOwned(id, userId);
    if (!cv.document) throw new ApiError('DOCUMENT_NOT_READY');
    const page = renderCvHtml(cv.document, { fonts: { embedded: this.fonts } });
    // A replacer function: a string would expand `$&` and friends found in the CV text.
    const html = page.replace('<head>', () => `<head>${CSP}`);
    // Without the policy the page would go to the browser unprotected; a template without `<head>` must fail loudly.
    if (html === page)
      throw new Error('The CV template has no <head> to put the security policy in');
    return { bytes: await this.renderer.render(html), fullName: cv.document.contacts.fullName };
  }
}
