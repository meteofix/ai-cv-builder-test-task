import type { Question } from '@cv/shared';
import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editorDocument, question } from './test/fixtures';
import { CV_ID, cvDetail, job, mockRoute, problem, USER } from './test/mock-api';
import { renderApp } from './test/render';
import { server } from './test/server';
import { setViewport } from './test/viewport';
import { HttpResponse } from 'msw';

const saved: { download?: string; href?: string }[] = [];
let revoke = vi.fn();

beforeEach(() => {
  saved.length = 0;
  // jsdom has neither function: define them for the test and remove them afterwards.
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:cv'),
    configurable: true,
    writable: true,
  });
  revoke = vi.fn();
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: revoke,
    configurable: true,
    writable: true,
  });
  // jsdom cannot navigate: record what the click would have downloaded.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(
    this: HTMLAnchorElement,
  ) {
    saved.push({ download: this.download, href: this.href });
  });
});
afterEach(() => {
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
  vi.restoreAllMocks();
  vi.useRealTimers();
  setViewport('desktop');
});

function handlers(questions: Question[] = []) {
  server.use(
    mockRoute('me', () => USER),
    mockRoute('getCv', () => cvDetail({ document: editorDocument(), questions })),
    mockRoute('getNotInCv', () => ({ items: [] })),
  );
}

describe('PDF download', () => {
  it('fetches the PDF and saves it under the name of Content-Disposition', async () => {
    handlers();
    server.use(
      mockRoute(
        'downloadPdf',
        () =>
          new HttpResponse(new Uint8Array([37, 80, 68, 70]), {
            headers: {
              'content-type': 'application/pdf',
              'content-disposition': 'attachment; filename="Iryna-Kovalenko-CV.pdf"',
            },
          }),
      ),
    );
    const { user } = renderApp(`/cvs/${CV_ID}`);

    await user.click(await screen.findByRole('button', { name: 'Download PDF' }));

    await vi.waitFor(() => {
      expect(saved).toEqual([{ download: 'Iryna-Kovalenko-CV.pdf', href: 'blob:cv' }]);
    });
    await vi.waitFor(
      () => {
        expect(revoke).toHaveBeenCalledWith('blob:cv');
      },
      { timeout: 3000 },
    );
  });

  it.each([
    ['DOCUMENT_NOT_READY', 'The CV is not ready yet.'],
    ['PDF_RENDER_FAILED', 'The PDF could not be created. Try again. Error ID: req-test'],
  ] as const)('shows the message of %s', async (code, message) => {
    handlers();
    server.use(mockRoute('downloadPdf', () => problem(code)));
    const { user } = renderApp(`/cvs/${CV_ID}`);

    await user.click(await screen.findByRole('button', { name: 'Download PDF' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(saved).toEqual([]);
  });

  it('is disabled while a save is pending and while a job is active', async () => {
    handlers();
    server.use(
      mockRoute('updateDocument', ({ body }) => ({
        document: (body as { document: never }).document,
        version: 4,
      })),
    );
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    const { user } = renderApp(`/cvs/${CV_ID}`);
    const button = await screen.findByRole('button', { name: 'Download PDF' });
    expect(button).toBeEnabled();

    await user.type(screen.getByLabelText('Headline'), '!');
    expect(button).toBeDisabled();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(button).toBeEnabled();
    });
  });

  it('is disabled while the AI updates the CV', async () => {
    server.use(
      mockRoute('me', () => USER),
      mockRoute('getCv', () =>
        cvDetail({
          document: editorDocument(),
          job: job({ kind: 'apply_answer', status: 'running', step: 'write' }),
        }),
      ),
      mockRoute('getJob', () => job({ kind: 'apply_answer', status: 'running', step: 'write' })),
      mockRoute('getNotInCv', () => ({ items: [] })),
    );
    renderApp(`/cvs/${CV_ID}`);

    expect(await screen.findByRole('button', { name: 'Download PDF' })).toBeDisabled();
  });
});

describe('phone layout', () => {
  it('has a section bar with the question counters, an action bar and no preview column', async () => {
    setViewport('phone');
    handlers([question()]);
    renderApp(`/cvs/${CV_ID}`);

    const bar = await screen.findByRole('navigation', { name: 'CV sections' });
    const experience = within(bar).getByRole('link', { name: /Experience/ });
    expect(experience).toHaveTextContent(/Experience\s*1\s*question/);
    expect(within(bar).getByRole('link', { name: 'Contacts' })).toHaveAttribute(
      'href',
      '#section-contacts',
    );
    expect(screen.queryByRole('complementary', { name: 'Preview' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
  });

  it('opens the preview in a dialog and closes it again', async () => {
    setViewport('phone');
    handlers();
    const { user } = renderApp(`/cvs/${CV_ID}`);

    await user.click(await screen.findByRole('button', { name: 'Preview' }));
    const dialog = screen.getByRole('dialog', { name: 'Preview' });
    await vi.waitFor(() => {
      expect(dialog.querySelector('iframe')?.contentDocument?.body.textContent).toContain(
        'Iryna Kovalenko',
      );
    });

    await user.click(within(dialog).getByRole('button', { name: 'Close preview' }));
    expect(screen.queryByRole('dialog', { name: 'Preview' })).not.toBeInTheDocument();
  });

  it('keeps the Download PDF button off the desktop header on a phone: only the action bar has it', async () => {
    setViewport('phone');
    handlers();
    renderApp(`/cvs/${CV_ID}`);

    await screen.findByRole('navigation', { name: 'CV sections' });
    expect(screen.getAllByRole('button', { name: 'Download PDF' })).toHaveLength(1);
  });

  it('closing the dialog (also with Esc) unmounts the preview', async () => {
    setViewport('phone');
    handlers();
    const { user } = renderApp(`/cvs/${CV_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Preview' }));
    const dialog = screen.getByRole('dialog', { name: 'Preview' });
    expect(dialog.querySelector('iframe')).not.toBeNull();

    // Esc makes the browser close the dialog itself, which fires `close`.
    act(() => {
      (dialog as HTMLDialogElement).close();
    });

    expect(document.querySelector('dialog.preview-dialog iframe')).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Preview' })).not.toBeInTheDocument();
  });

  it('switching between the layouts never shows two "Download PDF" buttons', async () => {
    handlers();
    renderApp(`/cvs/${CV_ID}`);
    await screen.findByRole('button', { name: 'Download PDF' });
    expect(screen.getAllByRole('button', { name: 'Download PDF' })).toHaveLength(1);
    expect(screen.queryByRole('navigation', { name: 'CV sections' })).not.toBeInTheDocument();

    setViewport('phone');
    expect(await screen.findByRole('navigation', { name: 'CV sections' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Download PDF' })).toHaveLength(1);

    setViewport('desktop');
    expect(screen.queryByRole('navigation', { name: 'CV sections' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Download PDF' })).toHaveLength(1);
  });
});
