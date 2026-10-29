import type { Job } from '@cv/shared';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorDocument } from './test/fixtures';
import { CV_ID, cvDetail, job, mockRoute, problem, USER } from './test/mock-api';
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

describe('recovering from a failed request', () => {
  it('keeps polling a job whose first status request failed, until it ends', async () => {
    let requests = 0;
    const running: Job = job({ status: 'running', step: 'write' });
    server.use(
      mockRoute('me', () => USER),
      mockRoute('getCv', () => cvDetail({ document: null, job: running })),
      mockRoute('getJob', () => {
        requests += 1;
        if (requests === 1) return problem('INTERNAL');
        return requests === 2 ? running : job({ status: 'succeeded', step: 'finalize' });
      }),
      mockRoute('getDraft', () => ({ draft: editorDocument() })),
    );
    fakeClock();
    renderApp(`/cvs/${CV_ID}`);
    await vi.waitFor(() => {
      expect(requests).toBe(1);
    });

    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => {
      expect(requests).toBe(3);
    });

    // The job ended: no more polling, and the stepper shows it.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(requests).toBe(3);
    expect(document.querySelector('.stepper__step--done')).not.toBeNull();
  });

  it('keeps polling the job the CV names even when the cache holds an earlier one', async () => {
    let requests = 0;
    const earlier = job({ id: '11111111-1111-4111-8111-111111111111' });
    const current = job({
      id: '22222222-2222-4222-8222-222222222222',
      kind: 'apply_answer',
      status: 'running',
      step: 'write',
    });
    server.use(
      mockRoute('me', () => USER),
      mockRoute('getCv', () => cvDetail({ document: editorDocument(), job: current })),
      mockRoute('getNotInCv', () => ({ items: [] })),
      mockRoute('getJob', () => {
        requests += 1;
        return requests === 1 ? problem('INTERNAL') : current;
      }),
    );
    fakeClock();
    const { queryClient } = renderApp(`/cvs/${CV_ID}`);
    // The generation of this CV left its succeeded job in the cache.
    queryClient.setQueryData(['cv-job', CV_ID], earlier);

    await vi.advanceTimersByTimeAsync(10_000);

    await vi.waitFor(() => {
      expect(requests).toBeGreaterThanOrEqual(2);
    });
  });

  it('does not ask again for a CV that does not exist', async () => {
    let requests = 0;
    server.use(
      mockRoute('me', () => USER),
      mockRoute('getCv', () => {
        requests += 1;
        return problem('CV_NOT_FOUND');
      }),
    );
    fakeClock();
    renderApp(`/cvs/${CV_ID}`);
    expect(await screen.findByText('This CV does not exist.')).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(requests).toBe(1);
  });

  it('gives up on an API that stays down instead of asking forever', async () => {
    let requests = 0;
    server.use(
      mockRoute('me', () => USER),
      mockRoute('getCv', () => {
        requests += 1;
        return problem('INTERNAL');
      }),
    );
    fakeClock();
    renderApp(`/cvs/${CV_ID}`);
    await vi.waitFor(() => {
      expect(requests).toBe(1);
    });

    await vi.advanceTimersByTimeAsync(20 * 60_000);

    // Backoff up to 15 s and at most 20 retries.
    expect(requests).toBeLessThanOrEqual(22);
    const settled = requests;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(requests).toBe(settled);
  });

  it('asks again for the finished CV when the first fetch after the job failed', async () => {
    let cvRequests = 0;
    server.use(
      mockRoute('me', () => USER),
      mockRoute('getCv', () => {
        cvRequests += 1;
        if (cvRequests === 1)
          return cvDetail({ document: null, job: job({ status: 'running', step: 'judge' }) });
        if (cvRequests === 2) return problem('INTERNAL');
        return cvDetail({ document: editorDocument() });
      }),
      mockRoute('getJob', () => job()),
      mockRoute('getDraft', () => ({ draft: null })),
      mockRoute('getNotInCv', () => ({ items: [] })),
    );
    fakeClock();
    renderApp(`/cvs/${CV_ID}`);

    // The retry comes after one polling interval (1.5 s of the fake clock).
    expect(
      await screen.findByLabelText('Headline', undefined, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(cvRequests).toBeGreaterThanOrEqual(3);
  });

  it('does not let the source tabs change while a CV is being created', async () => {
    let release: () => void = vi.fn();
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      mockRoute('me', () => USER),
      mockRoute('createCvFromText', async () => {
        await gate;
        return problem('GENERATION_LIMIT_REACHED', { detail: 'Limit reached.' });
      }),
    );
    const { user } = renderApp('/cvs/new');
    await user.click(await screen.findByRole('tab', { name: 'Paste text' }));
    await user.type(screen.getByLabelText('Target role'), 'Analyst');
    await user.type(screen.getByLabelText('CV text'), 'Some CV text');
    await user.click(screen.getByRole('button', { name: 'Create CV' }));

    expect(screen.getByRole('tab', { name: 'Upload PDF' })).toBeDisabled();
    release();
    expect(await screen.findByText('Limit reached.')).toBeInTheDocument();
    // The request that was pending ended on this page, on the tab it started from.
    expect(screen.getByRole('tab', { name: 'Paste text' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Upload PDF' })).toBeEnabled();
  });
});
