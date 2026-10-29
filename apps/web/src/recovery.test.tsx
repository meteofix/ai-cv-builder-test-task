import type { UpdateDocumentRequest } from '@cv/shared';
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorDocument } from './test/fixtures';
import { CV_ID, cvDetail, mockRoute, problem, USER } from './test/mock-api';
import { renderApp } from './test/render';
import { server } from './test/server';

afterEach(() => {
  vi.useRealTimers();
});

function fakeClock() {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
}

async function mountEditor() {
  const puts: UpdateDocumentRequest[] = [];
  fakeClock();
  server.use(
    mockRoute('me', () => USER),
    mockRoute('getCv', () => cvDetail({ document: editorDocument(), version: 3 })),
    mockRoute('getNotInCv', () => ({ items: [] })),
    mockRoute('listCvs', () => ({ items: [] })),
    mockRoute('updateDocument', ({ body }) => {
      const request = body as UpdateDocumentRequest;
      puts.push(request);
      return { document: request.document, version: request.version + 1 };
    }),
  );
  const view = renderApp(`/cvs/${CV_ID}`);
  await screen.findByLabelText('Headline');
  return { ...view, puts };
}

describe('a session that is only unreachable is not an expired session', () => {
  it('keeps the page and its unsaved form when the refresh of the user fails', async () => {
    const { user, queryClient } = await mountEditor();
    await user.type(screen.getByLabelText('Headline'), '!');
    server.use(mockRoute('me', () => problem('INTERNAL')));

    await queryClient.refetchQueries({ queryKey: ['me'] });

    expect(screen.getByLabelText('Headline')).toHaveValue('Senior Full-Stack Engineer!');
    expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument();
  });

  it('a save refused with 401 ends the session like any request', async () => {
    const { user } = await mountEditor();
    server.use(mockRoute('updateDocument', () => problem('UNAUTHENTICATED')));

    await user.type(screen.getByLabelText('Headline'), 'A');
    await vi.advanceTimersByTimeAsync(1000);

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });
});

describe('leaving the editor with unsaved edits', () => {
  it('saves them first, then leaves', async () => {
    let release: () => void = vi.fn();
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { user, puts } = await mountEditor();
    server.use(
      mockRoute('updateDocument', async ({ body }) => {
        const request = body as UpdateDocumentRequest;
        puts.push(request);
        await gate;
        return { document: request.document, version: request.version + 1 };
      }),
    );

    await user.type(screen.getByLabelText('Headline'), '!');
    await user.click(screen.getByRole('link', { name: 'CV Builder' }));

    // The save is in flight: the editor is still there, and the navigation waits for it.
    await vi.waitFor(() => {
      expect(puts).toHaveLength(1);
    });
    expect(screen.getByLabelText('Headline')).toBeInTheDocument();
    release();
    expect(await screen.findByRole('heading', { name: 'Your CVs' })).toBeInTheDocument();
    expect(puts).toHaveLength(1);
    expect(puts[0]?.document.headline).toBe('Senior Full-Stack Engineer!');
  });

  it('a conflict while leaving keeps the person on the page, where the notice is', async () => {
    const { user } = await mountEditor();
    server.use(
      mockRoute('updateDocument', () => problem('VERSION_CONFLICT')),
      mockRoute('getCv', () =>
        cvDetail({ document: editorDocument({ headline: 'Changed elsewhere' }), version: 5 }),
      ),
    );

    await user.type(screen.getByLabelText('Headline'), '!');
    await user.click(screen.getByRole('link', { name: 'CV Builder' }));

    expect(
      await screen.findByText('This CV was changed elsewhere. We loaded the latest version.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Headline')).toHaveValue('Changed elsewhere');
    expect(screen.queryByRole('heading', { name: 'Your CVs' })).not.toBeInTheDocument();
  });

  it('a 401 while leaving goes to /login without asking anything', async () => {
    const { user } = await mountEditor();
    server.use(mockRoute('updateDocument', () => problem('UNAUTHENTICATED')));

    await user.type(screen.getByLabelText('Headline'), '!');
    await user.click(screen.getByRole('link', { name: 'CV Builder' }));

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Leave without saving?' })).not.toBeInTheDocument();
  });

  it('asks when they cannot be saved: Cancel stays with the edits, Leave goes', async () => {
    const { user, puts } = await mountEditor();
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.type(screen.getByLabelText('Link 1'), 'https://');

    await user.click(screen.getByRole('link', { name: 'CV Builder' }));
    const dialog = await screen.findByRole('dialog', { name: 'Leave without saving?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.getByLabelText('Link 1')).toHaveValue('https://');
    expect(puts).toHaveLength(0);

    await user.click(screen.getByRole('link', { name: 'CV Builder' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Leave without saving?' })).getByRole(
        'button',
        { name: 'Leave' },
      ),
    );
    expect(await screen.findByRole('heading', { name: 'Your CVs' })).toBeInTheDocument();
  });

  it('keeps the server message of a failed save, with its Error ID, while it retries', async () => {
    const { user } = await mountEditor();
    server.use(mockRoute('updateDocument', () => problem('INTERNAL', { requestId: 'req-5' })));

    await user.type(screen.getByLabelText('Headline'), 'A');
    await vi.advanceTimersByTimeAsync(1000);

    expect(await screen.findByText(/Error ID: req-5/)).toBeInTheDocument();
  });
});

describe('logging out of the editor', () => {
  function logoutHandlers() {
    let signedIn = true;
    server.use(
      mockRoute('me', () => (signedIn ? USER : problem('UNAUTHENTICATED'))),
      mockRoute('logout', () => {
        signedIn = false;
        return undefined;
      }),
      mockRoute('login', () => {
        signedIn = true;
        return USER;
      }),
    );
  }

  it('saves the edits first, then lands on a plain /login that does not lead back to this CV', async () => {
    const { user, puts } = await mountEditor();
    logoutHandlers();

    await user.type(screen.getByLabelText('Headline'), '!');
    await user.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(puts).toHaveLength(1);

    await user.type(screen.getByLabelText('Email'), 'iryna@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(
      await screen.findByRole('heading', { name: 'Your CVs' }, { timeout: 4000 }),
    ).toBeInTheDocument();
  });

  it('asks when the edits cannot be saved, and logs out when the person insists', async () => {
    const { user, puts } = await mountEditor();
    logoutHandlers();
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.type(screen.getByLabelText('Link 1'), 'https://');

    await user.click(screen.getByRole('button', { name: 'Log out' }));
    const dialog = await screen.findByRole('dialog', { name: 'Log out without saving?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByLabelText('Link 1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Log out' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Log out without saving?' })).getByRole(
        'button',
        { name: 'Log out' },
      ),
    );
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(puts).toHaveLength(0);
  });
});
