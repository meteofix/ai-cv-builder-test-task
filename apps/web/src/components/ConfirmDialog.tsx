import { useEffect, useId, useRef } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Text under the title, e.g. which CV is affected. */
  message?: string;
  confirmLabel: string;
  onConfirm: () => void;
  /** Also called when the dialog closes itself (Esc), so `open` must be set to false here. */
  onCancel: () => void;
}

/**
 * A native modal `<dialog>`: focus handling and Esc come from the browser. The browser's `close` event also
 * follows a confirmed action, so `onCancel` must be idempotent (setting state to "closed" is).
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby={titleId}
      aria-describedby={message ? messageId : undefined}
      onClose={onCancel}
    >
      <div className="confirm-dialog__body">
        <h2 className="confirm-dialog__title" id={titleId}>
          {title}
        </h2>
        {message ? (
          <p className="confirm-dialog__message" id={messageId}>
            {message}
          </p>
        ) : null}
        <div className="confirm-dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn--danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
