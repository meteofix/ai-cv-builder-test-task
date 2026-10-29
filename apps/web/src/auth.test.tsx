import { MutationObserver, type QueryClient } from '@tanstack/react-query';
import { act, screen } from '@testing-library/react';
import { HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { api } from './api/client';
import { queryKeys } from './api/keys';
import { mockRoute, nginxError, problem, USER } from './test/mock-api';
import { renderApp } from './test/render';
import { server } from './test/server';

/** A server whose session starts out missing and appears after a successful login. */
function sessionServer(login: Parameters<typeof mockRoute<'login'>>[1]) {
  let signedIn = false;
  server.use(
    mockRoute('me', () => (signedIn ? USER : problem('UNAUTHENTICATED'))),
    mockRoute('login', async (info) => {
      const result = await login(info);
      if (!(result instanceof Response)) signedIn = true;
      return result;
    }),
  );
}

async function fillAndSubmit(
  user: ReturnType<typeof renderApp>['user'],
  password = 'correct horse',
) {
  await user.type(await screen.findByLabelText('Email'), 'iryna@example.com');
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Log in' }));
}

describe('auth screens', () => {
  it('WEB-1 — sign-in gate: /cvs/new shows login without a session and returns there after login', async () => {
    sessionServer(() => USER);
    const { user } = renderApp('/cvs/new');

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'New CV' })).not.toBeInTheDocument();

    await fillAndSubmit(user);

    expect(await screen.findByRole('heading', { name: 'New CV' })).toBeInTheDocument();
  });

  it('WEB-2 — login error: wrong credentials show the message and the password keeps focus', async () => {
    sessionServer(() => problem('INVALID_CREDENTIALS'));
    const { user } = renderApp('/login');

    await fillAndSubmit(user, 'wrong password');

    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.');
    expect(screen.getByLabelText('Password')).toHaveFocus();
    expect(screen.getByLabelText('Email')).toHaveValue('iryna@example.com');
  });

  it.each([
    ['EMAIL_TAKEN', 'An account with this email already exists.'],
    ['RATE_LIMITED', 'Too many attempts. Wait a minute and try again.'],
  ] as const)('sign-up maps %s to its message', async (code, message) => {
    server.use(
      mockRoute('me', () => problem('UNAUTHENTICATED')),
      mockRoute('signup', () => problem(code)),
    );
    const { user } = renderApp('/signup');

    await user.type(await screen.findByLabelText('Email'), 'iryna@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('checks the credentials with the shared limits before sending anything', async () => {
    server.use(mockRoute('me', () => problem('UNAUTHENTICATED')));
    const { user } = renderApp('/login');

    await user.type(await screen.findByLabelText('Email'), 'not-an-email');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Use 8–128 characters.')).toBeInTheDocument();
  });

  it.each([
    [
      'a query',
      (queryClient: QueryClient) =>
        queryClient.query({ queryKey: queryKeys.cvs, queryFn: () => api('listCvs') }),
    ],
    [
      'a mutation',
      (queryClient: QueryClient) =>
        new MutationObserver(queryClient, {
          mutationFn: () =>
            api('createCvFromText', { body: { targetRole: 'Analyst', text: 'cv' } }),
        }).mutate(),
    ],
  ])(
    'a 401 UNAUTHENTICATED from %s leads to /login and drops the cached CVs',
    async (_kind, call) => {
      server.use(
        mockRoute('me', () => USER),
        mockRoute('listCvs', () => problem('UNAUTHENTICATED')),
        mockRoute('createCvFromText', () => problem('UNAUTHENTICATED')),
      );
      const { queryClient } = renderApp('/');
      expect(await screen.findByRole('heading', { name: 'Your CVs' })).toBeInTheDocument();
      queryClient.setQueryData(queryKeys.cv('some-cv'), { private: 'data' });

      await expect(call(queryClient)).rejects.toThrow();

      expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
      expect(queryClient.getQueryData(queryKeys.cv('some-cv'))).toBeUndefined();
    },
  );

  it('logging out ends the session, clears the cache and lands on a clean /login', async () => {
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
    const { user, queryClient } = renderApp('/cvs/new');
    await screen.findByRole('heading', { name: 'New CV' });
    queryClient.setQueryData(queryKeys.cv('some-cv'), { private: 'data' });

    await user.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(queryClient.getQueryData(queryKeys.cv('some-cv'))).toBeUndefined();

    // A second sign-in does not return to the page that was open when the first account left.
    await fillAndSubmit(user);
    expect(
      await screen.findByRole('heading', { name: 'Your CVs' }, { timeout: 4000 }),
    ).toBeInTheDocument();
  });

  it('a failed logout keeps the session and says why', async () => {
    server.use(
      mockRoute('me', () => USER),
      mockRoute('listCvs', () => ({ items: [] })),
      mockRoute('logout', () => problem('INTERNAL', { requestId: 'req-7' })),
    );
    const { user } = renderApp('/');
    await screen.findByRole('heading', { name: 'Your CVs' });

    await user.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Error ID: req-7');
    expect(screen.getByRole('heading', { name: 'Your CVs' })).toBeInTheDocument();
  });
});

describe('connection', () => {
  it('a request that gets no answer says the user is offline and raises the banner', async () => {
    server.use(
      mockRoute('me', () => problem('UNAUTHENTICATED')),
      mockRoute('login', () => HttpResponse.error()),
    );
    const { user } = renderApp('/login');

    await fillAndSubmit(user);

    expect(
      await screen.findByText('You are offline. Check your connection and try again.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Connection lost. Your changes stay on this page.'),
    ).toBeInTheDocument();
  });

  it("the API's own 503 is an answer, not a lost connection", async () => {
    server.use(
      mockRoute('me', () => problem('UNAUTHENTICATED')),
      mockRoute('login', () => problem('UNAVAILABLE')),
    );
    const { user } = renderApp('/login');

    await fillAndSubmit(user);

    await screen.findByRole('alert');
    expect(screen.queryByText(/Connection lost/)).not.toBeInTheDocument();
  });

  it('the browser going offline and back raises and clears the banner', async () => {
    server.use(mockRoute('me', () => problem('UNAUTHENTICATED')));
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Log in' });
    const online = vi.spyOn(navigator, 'onLine', 'get');

    online.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText(/Connection lost/)).toBeInTheDocument();

    online.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByText(/Connection lost/)).not.toBeInTheDocument();
  });
});

describe('error messages', () => {
  it('WEB-13 — a 500 problem+json shows the Error ID', async () => {
    server.use(
      mockRoute('me', () => problem('UNAUTHENTICATED')),
      mockRoute('login', () => problem('INTERNAL', { requestId: 'req-42' })),
    );
    const { user } = renderApp('/login');

    await fillAndSubmit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Error ID: req-42',
    );
  });

  it.each([
    [413, 'The file is too large (max 10 MB).'],
    [502, 'Cannot reach the server. Try again in a moment.'],
  ])('WEB-13 — a %i with an HTML body maps by status', async (status, message) => {
    server.use(
      mockRoute('me', () => problem('UNAUTHENTICATED')),
      mockRoute('login', () => nginxError(status)),
    );
    const { user } = renderApp('/login');

    await fillAndSubmit(user);

    // A 502 also raises the connection banner, which is a second alert.
    expect(await screen.findByText(message)).toBeInTheDocument();
  });
});
