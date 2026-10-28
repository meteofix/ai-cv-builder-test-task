import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { App } from '../App';
import { createQueryClient } from '../api/query-client';

/** The whole app at `path`, with a fresh query cache so tests do not share server state. */
export function renderApp(path = '/') {
  const queryClient = createQueryClient();
  // `applyAccept: false`: the app checks the type itself, and the tests choose files the picker would hide.
  const user = userEvent.setup({
    applyAccept: false,
    advanceTimers: (ms) => {
      if (vi.isFakeTimers()) vi.advanceTimersByTime(ms);
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, user, queryClient };
}
