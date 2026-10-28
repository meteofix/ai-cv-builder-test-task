import { JOB_STEPS, type Job, type JobStep } from '@cv/shared';
import { Icon, Spinner } from './Icon';

const LABELS: Record<JobStep, string> = {
  extract: 'Reading your CV',
  write: 'Writing',
  judge: 'Checking facts',
  finalize: 'Finishing',
};

type StepState = 'done' | 'active' | 'failed' | 'pending';

function stepState(index: number, job: Job): StepState {
  if (job.status === 'succeeded') return 'done';
  // A job that has not started has no step yet: the first one is next.
  const current = job.step ? JOB_STEPS.indexOf(job.step) : 0;
  if (index < current) return 'done';
  if (index > current) return 'pending';
  return job.status === 'failed' ? 'failed' : 'active';
}

export function Stepper({ job }: { job: Job }) {
  return (
    <ol className="stepper">
      {JOB_STEPS.map((step, index) => {
        const state = stepState(index, job);
        const classes =
          state === 'pending' ? 'stepper__step' : `stepper__step stepper__step--${state}`;
        return (
          <li
            key={step}
            className={classes}
            aria-current={state === 'active' || state === 'failed' ? 'step' : undefined}
          >
            <span className="stepper__bar" />
            <span className="stepper__label">
              {state === 'done' ? <Icon name="check" small /> : null}
              {state === 'failed' ? <Icon name="alert" small /> : null}
              {state === 'active' ? <Spinner /> : null}
              {state === 'pending' ? <span className="stepper__marker" aria-hidden="true" /> : null}
              {LABELS[step]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
