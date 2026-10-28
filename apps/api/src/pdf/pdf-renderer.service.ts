import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PDF_OPTIONS } from '@cv/cv-template';
import { chromium, type Browser } from 'playwright';
import type { Logger } from 'pino';
import { ApiError } from '../common/api-error.js';
import { ROOT_LOGGER } from '../config/tokens.js';
import { assertFontsLoaded, FONT_CHECK_SCRIPT, type FontCheckResult } from './font-check.js';

const MAX_CONCURRENT_RENDERS = 2;
/** Covers waiting for a free slot as well as the render itself. */
const RENDER_TIMEOUT_MS = 15_000;

/** What the deadline of one render needs to stop it. */
interface RenderJob {
  timedOut: boolean;
  closeContext?: () => Promise<unknown>;
}

/**
 * Prints HTML to PDF with one Chromium per process. At most two renders run at once; the others wait their
 * turn. Any failure is a 503 PDF_RENDER_FAILED, never a PDF in a fallback font.
 */
@Injectable()
export class PdfRenderer implements OnModuleDestroy {
  private readonly logger: Logger;
  private browser: Promise<Browser> | undefined;
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(@Inject(ROOT_LOGGER) logger: Logger) {
    this.logger = logger.child({ context: 'pdf' });
  }

  async render(html: string): Promise<Buffer> {
    const job: RenderJob = { timedOut: false };
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        job.timedOut = true;
        // Closing the context makes the pending Playwright calls of this render fail at once.
        void job.closeContext?.();
        reject(new Error('PDF render timed out'));
      }, RENDER_TIMEOUT_MS);
    });
    const rendered = this.inSlot(() => {
      // Waited so long for a slot that the request has already been answered.
      if (job.timedOut) return Promise.reject(new Error('PDF render timed out'));
      return this.print(html, job);
    });
    try {
      return await Promise.race([rendered, deadline]);
    } catch (error) {
      this.logger.warn(
        { errorName: error instanceof Error ? error.name : 'unknown', cause: describe(error) },
        'PDF render failed',
      );
      throw new ApiError(
        'PDF_RENDER_FAILED',
        'The PDF could not be created. Try again in a moment.',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async onModuleDestroy(): Promise<void> {
    // A launch that failed left no browser to close; its error was already reported to the request.
    const browser = await this.browser?.catch(() => undefined);
    await browser?.close();
  }

  private async print(html: string, job: RenderJob): Promise<Buffer> {
    const browser = await this.getBrowser();
    // Offline: the page may not fetch anything, all fonts are inlined.
    const context = await browser.newContext({ offline: true });
    // After a crash or a timeout there is nothing left to release, so a failing close is not an error.
    const close = () => context.close().catch(() => undefined);
    job.closeContext = close;
    try {
      // The deadline passed while the browser was starting: nobody is waiting for this PDF any more.
      if (job.timedOut) throw new Error('PDF render timed out');
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      assertFontsLoaded(await page.evaluate<FontCheckResult>(FONT_CHECK_SCRIPT));
      return await page.pdf(PDF_OPTIONS);
    } finally {
      await close();
    }
  }

  /** One launch at a time; a crashed or closed browser is dropped so the next request starts a new one. */
  private getBrowser(): Promise<Browser> {
    this.browser ??= chromium
      .launch({ args: ['--disable-dev-shm-usage'], chromiumSandbox: false })
      .then((browser) => {
        browser.once('disconnected', () => {
          this.browser = undefined;
        });
        return browser;
      })
      .catch((error: unknown) => {
        this.browser = undefined;
        throw error;
      });
    return this.browser;
  }

  /** Hands the slot of a finished render straight to the next waiter, so a newcomer cannot slip in. */
  private async inSlot<T>(work: () => Promise<T>): Promise<T> {
    if (this.running < MAX_CONCURRENT_RENDERS) this.running++;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.running--;
    }
  }
}

/** Name and message of Playwright's or our own error; neither contains the CV. */
function describe(error: unknown): string {
  return error instanceof Error
    ? (error.message.split('\n')[0] ?? '').slice(0, 200)
    : 'unknown error';
}
