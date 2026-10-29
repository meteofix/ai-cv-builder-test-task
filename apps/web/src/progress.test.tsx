import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Job } from '@cv/shared';
import { CV_ID, cvDetail, job, mockRoute, problem, USER } from './test/mock-api';
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

function previewText(): string {
  return document.querySelector('iframe')?.contentDocument?.body.textContent ?? '';
}

function stepClasses(): string[] {
  return [...document.querySelectorAll('.stepper__step')].map((step) => step.className);
}

function currentStep(): string {
  return document.querySelector('[aria-current="step"]')?.textContent ?? '';
}

describe('generation progress', () => {
  it('WEB-5 — the stepper follows the job, then the CV is shown', async () => {
    useFakeClock();
    const sequence: Job[] = [
      job({ status: 'queued', step: null }),
      job({ status: 'running', step: 'write' }),
      job({ status: 'running', step: 'judge' }),
      job({ status: 'succeeded', step: 'finalize' }),
    ];
    let jobRequests = 0;
    let cvRequests = 0;
    server.use(
      mockRoute('me', () => USER),
      mockRoute('getCv', () => {
        cvRequests += 1;
        // Until the job has succeeded the CV has no document.
        return jobRequests < sequence.length
          ? cvDetail({ document: null, job: sequence[0] ?? null })
          : cvDetail();
      }),
      mockRoute('getJob', () => sequence[Math.min(jobRequests++, sequence.length - 1)] ?? job()),
    );
    renderApp(`/cvs/${CV_ID}`);

    await vi.waitFor(() => {
      expect(currentStep()).toContain('Writing');
    });
    expect(screen.getAllByRole('listitem')).toHaveLength(3);

    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => {
      expect(currentStep()).toContain('Checking the text');
    });
    // Writing is done, Checking the text is running, Finishing has not started.
    expect(stepClasses()).toEqual([
      'stepper__step stepper__step--done',
      'stepper__step stepper__step--active',
      'stepper__step',
    ]);
    expect(screen.getByText(/It usually takes under a minute\./)).toBeTruthy();
    // There is no draft before the CV is written.
    expect(document.querySelector('iframe')).toBeNull();

    await vi.advanceTimersByTimeAsync(1500);
    await vi.waitFor(() => {
      expect(previewText()).toContain('Full-stack engineer with 7 years of experience.');
      // The editor shows the finished document.
      expect(screen.getByLabelText('Full name')).toHaveValue('Iryna Kovalenko');
    });
    expect(cvRequests).toBeGreaterThanOrEqual(2);

    // Polling stopped with the job.
    const settled = jobRequests;
    await vi.advanceTimersByTimeAsync(6000);
    expect(jobRequests).toBe(settled);
  });

  it('a reload shows the same step', async () => {
    server.use(
      mockRoute('me', () => USER),
      mockRoute('getCv', () =>
        cvDetail({ document: null, job: job({ status: 'running', step: 'judge' }) }),
      ),
      mockRoute('getJob', () => job({ status: 'running', step: 'judge' })),
    );
    renderApp(`/cvs/${CV_ID}`);

    await vi.waitFor(() => {
      expect(currentStep()).toContain('Checking the text');
    });
  });

  it('a job at the retired extract step shows the first step', async () => {
    server.use(
      mockRoute('me', () => USER),
      mockRoute('getCv', () =>
        cvDetail({ document: null, job: job({ status: 'running', step: 'extract' }) }),
      ),
      mockRoute('getJob', () => job({ status: 'running', step: 'extract' })),
    );
    renderApp(`/cvs/${CV_ID}`);

    await vi.waitFor(() => {
      expect(currentStep()).toContain('Writing');
    });
  });

  it('WEB-6 — a failed job shows its message and Retry returns to the progress view', async () => {
    let retried = 0;
    server.use(
      mockRoute('me', () => USER),
      mockRoute('getCv', () =>
        cvDetail({
          document: null,
          job: job({
            status: retried ? 'queued' : 'failed',
            step: 'write',
            ...(retried
              ? {}
              : {
                  error: {
                    code: 'AI_UNAVAILABLE',
                    message: 'The AI service is unavailable right now.',
                  },
                }),
          }),
        }),
      ),
      mockRoute('getJob', () =>
        retried
          ? job({ status: 'running', step: 'write' })
          : job({
              status: 'failed',
              step: 'write',
              error: {
                code: 'AI_UNAVAILABLE',
                message: 'The AI service is unavailable right now.',
              },
            }),
      ),
      mockRoute('retryJob', () => {
        retried += 1;
        return job({ status: 'queued', step: 'write' });
      }),
    );
    const { user } = renderApp(`/cvs/${CV_ID}`);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The AI service is unavailable right now.',
    );
    // The step that failed is marked, the ones after it have not started.
    expect(stepClasses()).toEqual([
      'stepper__step stepper__step--failed',
      'stepper__step',
      'stepper__step',
    ]);

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await vi.waitFor(() => {
      expect(retried).toBe(1);
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
      expect(currentStep()).toContain('Writing');
    });
  });

  it('a failed job is not polled again', async () => {
    let jobRequests = 0;
    server.use(
      mockRoute('me', () => USER),
      mockRoute('getCv', () =>
        cvDetail({
          document: null,
          job: job({
            status: 'failed',
            step: 'write',
            error: { code: 'AI_UNAVAILABLE', message: 'The AI service is unavailable right now.' },
          }),
        }),
      ),
      mockRoute('getJob', () => {
        jobRequests += 1;
        return job({
          status: 'failed',
          step: 'write',
          error: { code: 'AI_UNAVAILABLE', message: 'The AI service is unavailable right now.' },
        });
      }),
    );
    renderApp(`/cvs/${CV_ID}`);
    await screen.findByRole('button', { name: 'Retry' });
    await vi.waitFor(() => {
      expect(jobRequests).toBe(1);
    });

    useFakeClock();
    await vi.advanceTimersByTimeAsync(6000);

    expect(jobRequests).toBe(1);
  });

  it.each([
    ['JOB_ACTIVE', 'The CV is being updated. Try again when it is done.'],
    ['JOB_NOT_RETRYABLE', 'This job cannot be retried.'],
    ['RATE_LIMITED', 'Too many attempts. Wait a minute and try again.'],
  ] as const)('a refused Retry (%s) says why next to the job error', async (code, message) => {
    const failed = job({
      status: 'failed',
      step: 'write',
      error: { code: 'AI_UNAVAILABLE', message: 'The AI service is unavailable right now.' },
    });
    server.use(
      mockRoute('me', () => USER),
      mockRoute('getCv', () => cvDetail({ document: null, job: failed })),
      mockRoute('getJob', () => failed),
      mockRoute('retryJob', () => problem(code)),
    );
    const { user } = renderApp(`/cvs/${CV_ID}`);

    await user.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByText('The AI service is unavailable right now.')).toBeInTheDocument();
  });
});
