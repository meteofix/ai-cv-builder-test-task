import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cvListItem, mockRoute, USER } from './test/mock-api';
import { renderApp } from './test/render';
import { server } from './test/server';

/** Polling is driven by timers; the other tests in this file run on real ones, because `findBy*` waits on them. */
function useFakeClock() {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('CV list', () => {
  it('WEB-3 — the list polls only while some item is generating or updating', async () => {
    useFakeClock();
    let requests = 0;
    server.use(
      mockRoute('me', () => USER),
      mockRoute('listCvs', () => {
        requests += 1;
        // The first two answers say "generating"; from the third on the CV is ready.
        return { items: [cvListItem({ state: requests < 3 ? 'generating' : 'ready' })] };
      }),
    );
    renderApp('/');

    await vi.waitFor(() => {
      expect(requests).toBe(1);
    });
    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => {
      expect(requests).toBe(2);
    });
    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => {
      expect(requests).toBe(3);
      expect(screen.getByText('Ready')).toBeInTheDocument();
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(requests).toBe(3);
  });

  it('shows the role, the name, the state and the open questions of every CV', async () => {
    server.use(
      mockRoute('me', () => USER),
      mockRoute('listCvs', () => ({
        items: [
          cvListItem({ id: '11111111-1111-4111-8111-111111111111', openQuestions: 2 }),
          cvListItem({
            id: '22222222-2222-4222-8222-222222222222',
            targetRole: 'Data Analyst',
            fullName: null,
            state: 'failed',
          }),
        ],
      })),
    );
    renderApp('/');

    expect(await screen.findByText('Senior Full-Stack Engineer')).toBeInTheDocument();
    expect(screen.getByText('Iryna Kovalenko')).toBeInTheDocument();
    expect(screen.getByText('2 open questions')).toBeInTheDocument();
    expect(screen.getByText('Data Analyst')).toBeInTheDocument();
    expect(screen.getByText('Untitled')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('deleting a CV asks first, and Cancel sends nothing', async () => {
    const deleted: string[] = [];
    server.use(
      mockRoute('me', () => USER),
      mockRoute('listCvs', () => ({ items: deleted.length ? [] : [cvListItem()] })),
      mockRoute('deleteCv', ({ params }) => {
        deleted.push(params.id ?? '');
        return undefined;
      }),
    );
    const { user } = renderApp('/');

    await user.click(
      await screen.findByRole('button', { name: 'Delete Senior Full-Stack Engineer' }),
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Delete this CV?');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deleted).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Delete Senior Full-Stack Engineer' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await vi.waitFor(() => {
      expect(deleted).toHaveLength(1);
      expect(screen.queryByText('Senior Full-Stack Engineer')).not.toBeInTheDocument();
    });
  });
});
