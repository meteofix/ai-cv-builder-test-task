import { Icon, Spinner } from '../components/Icon';
import type { SaveStatus as Status } from './autosave';

const VIEW: Record<Status, { className: string; text: string }> = {
  saved: { className: 'save-status--saved', text: 'Saved' },
  saving: { className: 'save-status--saving', text: 'Saving…' },
  failed: { className: 'save-status--failed', text: 'Save failed' },
  invalid: { className: 'save-status--failed', text: 'Not saved — fix the highlighted field' },
};

export function SaveStatus({ status }: { status: Status }) {
  const { className, text } = VIEW[status];
  return (
    <span
      className={`save-status ${className}`}
      role="status"
      aria-live="polite"
      aria-label="Save status"
    >
      {status === 'saving' ? <Spinner /> : null}
      {status === 'saved' ? <Icon name="check" small /> : null}
      {status === 'failed' || status === 'invalid' ? <Icon name="alert" small /> : null}
      {text}
    </span>
  );
}
