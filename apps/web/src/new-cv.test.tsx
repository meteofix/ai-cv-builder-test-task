import { LIMITS } from '@cv/shared';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CV_ID, cvDetail, job, mockRoute, problem, USER } from './test/mock-api';
import { renderApp } from './test/render';
import { server } from './test/server';

function pdfOfSize(bytes: number, name = 'cv.pdf', type = 'application/pdf') {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe('New CV', () => {
  it.each([
    ['an 11 MiB PDF', pdfOfSize(11 * 1024 * 1024), 'The file is too large (max 10 MB).'],
    ['a .png', pdfOfSize(1024, 'photo.png', 'image/png'), 'This file is not a PDF.'],
  ])('WEB-4 — %s is checked before upload: a message, no request', async (_name, file, message) => {
    let uploads = 0;
    server.use(
      mockRoute('me', () => USER),
      mockRoute('createCvFromPdf', () => {
        uploads += 1;
        return { cvId: CV_ID, job: job({ status: 'queued', step: null }) };
      }),
    );
    const { user } = renderApp('/cvs/new');

    await user.type(await screen.findByLabelText('Target role'), 'Data Analyst');
    await user.upload(screen.getByLabelText('PDF file'), file);

    expect(await screen.findByText(message)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create CV' }));
    // The upload would go through fetch and MSW, which take a few ticks: give a wrongly sent request time to arrive.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(uploads).toBe(0);
  });

  it('sends a PDF with the role and opens the new CV', async () => {
    let received: FormData | undefined;
    server.use(
      mockRoute('me', () => USER),
      mockRoute('createCvFromPdf', async ({ request }) => {
        received = await request.formData();
        return { cvId: CV_ID, job: job({ status: 'queued', step: null }) };
      }),
      mockRoute('getCv', () =>
        cvDetail({ document: null, job: job({ status: 'queued', step: null }) }),
      ),
      mockRoute('getJob', () => job({ status: 'queued', step: null })),
    );
    const { user } = renderApp('/cvs/new');

    await user.type(await screen.findByLabelText('Target role'), 'Data Analyst');
    await user.upload(screen.getByLabelText('PDF file'), pdfOfSize(2048));
    await user.click(screen.getByRole('button', { name: 'Create CV' }));

    expect(await screen.findByLabelText('Progress')).toBeInTheDocument();
    expect(received?.get('targetRole')).toBe('Data Analyst');
    expect((received?.get('file') as File).name).toBe('cv.pdf');
    // The API reads multipart fields in order: the role must come before the file.
    expect([...(received?.keys() ?? [])]).toEqual(['targetRole', 'file']);
  });

  it('sends pasted text with the role as JSON', async () => {
    let body: unknown;
    server.use(
      mockRoute('me', () => USER),
      mockRoute('createCvFromText', async ({ request }) => {
        body = await request.json();
        return { cvId: CV_ID, job: job({ status: 'queued', step: null }) };
      }),
      mockRoute('getCv', () =>
        cvDetail({ document: null, job: job({ status: 'queued', step: null }) }),
      ),
      mockRoute('getJob', () => job({ status: 'queued', step: null })),
    );
    const { user } = renderApp('/cvs/new');

    await user.click(await screen.findByRole('tab', { name: 'Paste text' }));
    await user.type(screen.getByLabelText('Target role'), 'Data Analyst');
    await user.click(screen.getByLabelText('CV text'));
    await user.paste('Iryna Kovalenko\nData Analyst at Acme');
    await user.click(screen.getByRole('button', { name: 'Create CV' }));

    await screen.findByLabelText('Progress');
    expect(body).toEqual({
      targetRole: 'Data Analyst',
      text: 'Iryna Kovalenko\nData Analyst at Acme',
    });
  });

  it('keeps the chosen file and the typed text when the tabs are switched', async () => {
    let uploaded: FormData | undefined;
    server.use(
      mockRoute('me', () => USER),
      mockRoute('createCvFromPdf', async ({ request }) => {
        uploaded = await request.formData();
        return problem('PDF_INVALID');
      }),
    );
    const { user } = renderApp('/cvs/new');

    await user.type(await screen.findByLabelText('Target role'), 'Data Analyst');
    await user.upload(screen.getByLabelText('PDF file'), pdfOfSize(2048));
    await user.click(screen.getByRole('tab', { name: 'Paste text' }));
    await user.type(screen.getByLabelText('CV text'), 'typed');
    await user.click(screen.getByRole('tab', { name: 'Upload PDF' }));
    await user.click(screen.getByRole('button', { name: 'Create CV' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This file is not a valid PDF.');
    expect((uploaded?.get('file') as File).name).toBe('cv.pdf');
    await user.click(screen.getByRole('tab', { name: 'Paste text' }));
    expect(screen.getByLabelText('CV text')).toHaveValue('typed');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('the arrow keys move between the tabs, and only the selected tab is a tab stop', async () => {
    server.use(mockRoute('me', () => USER));
    const { user } = renderApp('/cvs/new');

    const upload = await screen.findByRole('tab', { name: 'Upload PDF' });
    const paste = screen.getByRole('tab', { name: 'Paste text' });
    expect(upload).toHaveAttribute('tabindex', '0');
    expect(paste).toHaveAttribute('tabindex', '-1');

    upload.focus();
    await user.keyboard('{ArrowRight}');

    expect(paste).toHaveAttribute('aria-selected', 'true');
    expect(paste).toHaveFocus();
  });

  it('requires the role', async () => {
    server.use(mockRoute('me', () => USER));
    const { user } = renderApp('/cvs/new');

    await user.upload(await screen.findByLabelText('PDF file'), pdfOfSize(2048));
    await user.click(screen.getByRole('button', { name: 'Create CV' }));

    expect(await screen.findByText('Enter the role you are applying for.')).toBeInTheDocument();
  });

  it.each([
    [
      'PDF_ENCRYPTED',
      undefined,
      'This PDF is password-protected. Remove the password or paste the text instead.',
    ],
    ['PDF_INVALID', undefined, 'This file is not a valid PDF.'],
    ['PDF_TOO_LARGE', undefined, 'The PDF is too large (max 10 MB).'],
    [
      'PDF_NO_TEXT',
      undefined,
      'This PDF has no text layer (it looks scanned). Paste the text instead.',
    ],
    [
      'PDF_TOO_MANY_PAGES',
      undefined,
      `This PDF has more than ${LIMITS.maxPdfPages} pages. Paste the text instead.`,
    ],
    [
      'GENERATION_LIMIT_REACHED',
      'Daily limit of 30 generations reached.',
      'Daily limit of 30 generations reached.',
    ],
  ] as const)('maps the server code %s to a message', async (code, detail, message) => {
    server.use(
      mockRoute('me', () => USER),
      mockRoute('createCvFromPdf', () => problem(code, detail ? { detail } : {})),
    );
    const { user } = renderApp('/cvs/new');

    await user.type(await screen.findByLabelText('Target role'), 'Data Analyst');
    await user.upload(screen.getByLabelText('PDF file'), pdfOfSize(2048));
    await user.click(screen.getByRole('button', { name: 'Create CV' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });
});
