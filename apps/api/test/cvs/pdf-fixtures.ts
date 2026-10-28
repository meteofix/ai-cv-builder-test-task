import { chromium, type Browser } from 'playwright';

/** Starts the Chromium that prints the PDF fixtures (the headless shell from `pnpm playwright:install`). */
export function launchPrinter(): Promise<Browser> {
  return chromium.launch();
}

async function print(browser: Browser, html: string): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    await page.setContent(html);
    return await page.pdf({ format: 'A4' });
  } finally {
    await page.close();
  }
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** A one-page PDF with the text lines as selectable text. */
export function textPdf(browser: Browser, text: string): Promise<Buffer> {
  return print(
    browser,
    `<body><pre style="font: 14px sans-serif">${escapeHtml(text)}</pre></body>`,
  );
}

/** A PDF of `pages` pages, each with one line of text. */
export function manyPagesPdf(browser: Browser, pages: number): Promise<Buffer> {
  const sheets = Array.from(
    { length: pages },
    (_, i) => `<p style="page-break-after: always">Page ${i + 1} of the CV</p>`,
  );
  return print(browser, `<body>${sheets.join('')}</body>`);
}

/** A one-page PDF in a tiny font with `chars` characters of text, to go over the source text limit. */
export function longTextPdf(browser: Browser, chars: number): Promise<Buffer> {
  const words = 'experience '.repeat(Math.ceil(chars / 11));
  return print(browser, `<body><p style="font: 3px sans-serif">${words}</p></body>`);
}

/** A PDF whose only content is a picture of text: it looks like a CV but has no text to extract. */
export async function imageOnlyPdf(browser: Browser, text: string): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    await page.setContent(
      `<body style="margin:0"><pre style="font: 20px sans-serif">${escapeHtml(text)}</pre></body>`,
    );
    const png = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: 400, height: 200 },
    });
    return await print(
      browser,
      `<body><img src="data:image/png;base64,${png.toString('base64')}"></body>`,
    );
  } finally {
    await page.close();
  }
}

export interface UploadFile {
  name: string;
  type: string;
  bytes: Buffer;
}

/**
 * A `multipart/form-data` request body for `inject()`: the text fields and the optional `file` part, the
 * file first or last (a browser may send either order).
 */
export function multipart(
  fields: Record<string, string>,
  file?: UploadFile,
  order: 'fields-first' | 'file-first' = 'fields-first',
) {
  const boundary = '----cvtest7d3f1c';
  const fieldChunks = Object.entries(fields).map(([name, value]) =>
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    ),
  );
  const fileChunks = file
    ? [
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
            `Content-Type: ${file.type}\r\n\r\n`,
        ),
        file.bytes,
        Buffer.from('\r\n'),
      ]
    : [];
  const chunks =
    order === 'fields-first' ? [...fieldChunks, ...fileChunks] : [...fileChunks, ...fieldChunks];
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}
