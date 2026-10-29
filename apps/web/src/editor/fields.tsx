import type { ReactNode } from 'react';
import { Icon, Spinner } from '../components/Icon';

/** The "Updating…" label of a card or a section while an AI job rewrites it. */
export function UpdatingLabel() {
  return (
    <span className="entry-card__busy" role="status">
      <Spinner />
      Updating…
    </span>
  );
}

/** A small icon-only button with the 44 px target of the reference. */
export function IconButton({
  label,
  icon,
  onClick,
  disabled,
  variant = 'ghost',
}: {
  label: string;
  icon: 'close' | 'up' | 'down';
  onClick: () => void;
  disabled?: boolean;
  variant?: 'ghost' | 'secondary';
}) {
  return (
    <button
      type="button"
      className={`btn btn--icon btn--${variant}`}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

export function AddButton({
  children,
  onClick,
  disabled,
  variant = 'ghost',
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'ghost' | 'secondary';
}) {
  return (
    <button
      type="button"
      className={`btn btn--${variant} form-section__add`}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name="plus" />
      {children}
    </button>
  );
}

export function FieldError({ message, id }: { message: string | undefined; id?: string }) {
  return message ? (
    <span className="field__error" id={id}>
      {message}
    </span>
  ) : null;
}
