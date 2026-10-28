import {
  Catch,
  PayloadTooLargeException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { ProblemFilter } from '../common/problem.filter.js';

/**
 * The multipart limit cuts a too-large upload off with Nest's generic 413; on the upload route that means
 * "this PDF is too large", a code the web app can explain.
 */
@Catch(PayloadTooLargeException)
export class PdfTooLargeFilter implements ExceptionFilter {
  private readonly problems = new ProblemFilter();

  catch(_exception: PayloadTooLargeException, host: ArgumentsHost): void {
    // The limit is MAX_UPLOAD_BYTES from the environment, so the text names no number.
    this.problems.catch(new ApiError('PDF_TOO_LARGE', 'The PDF file is too large.'), host);
  }
}
