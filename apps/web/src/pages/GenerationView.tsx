import { useQueryClient } from '@tanstack/react-query';
import type { CvDetail } from '@cv/shared';
import { useEffect } from 'react';
import { useJob, useRetryJob } from '../api/cvs';
import { errorMessage } from '../api/errors';
import { queryKeys } from '../api/keys';
import { AppHeader } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { Stepper } from '../components/Stepper';

/** The CV has no document yet: the job writes it (its steps) or has failed (message, Retry). */
export function GenerationView({ cv }: { cv: CvDetail }) {
  const client = useQueryClient();
  const jobQuery = useJob(cv.id, true, cv.job);
  const job = jobQuery.data ?? cv.job;
  const retry = useRetryJob(cv.id);
  const succeeded = job?.status === 'succeeded';

  // The document is written in the same transaction that marks the job succeeded: fetch the CV to show it.
  useEffect(() => {
    if (succeeded) void client.invalidateQueries({ queryKey: queryKeys.cv(cv.id) });
  }, [succeeded, client, cv.id]);

  const failed = job?.status === 'failed';
  return (
    <>
      <AppHeader role={cv.targetRole} />
      <main className="generation">
        {jobQuery.isError ? <p role="alert">{errorMessage(jobQuery.error)}</p> : null}
        {failed ? (
          <div className="alert alert--danger" role="alert">
            <div className="alert__body">
              <Icon name="alert" className="alert__icon" />
              <div>
                <p className="alert__message">{job.error?.message ?? 'The generation failed.'}</p>
                {retry.isError ? <p>{errorMessage(retry.error)}</p> : null}
              </div>
            </div>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={retry.isPending}
              onClick={() => {
                retry.mutate();
              }}
            >
              <Icon name="retry" />
              Retry
            </button>
          </div>
        ) : null}
        {job ? (
          <section className="progress-panel" aria-label="Progress" aria-live="polite">
            <Stepper job={job} />
            {failed ? null : (
              <p className="progress-panel__note">
                You can close this page — generation continues. It usually takes under a minute.
              </p>
            )}
          </section>
        ) : null}
      </main>
    </>
  );
}
