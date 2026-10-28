import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from '../components/Icon';

interface PreviewDialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/** Phone only: the preview on the whole screen, in a native modal `<dialog>` (Esc and the close button). */
export function PreviewDialog({ open, onClose, children }: PreviewDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="preview-dialog" aria-labelledby={titleId} onClose={onClose}>
      <div className="preview-dialog__bar">
        <h2 className="preview-dialog__title" id={titleId}>
          Preview
        </h2>
        <button
          type="button"
          className="btn btn--icon btn--ghost"
          aria-label="Close preview"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      {/* Mounted only while open: a second iframe of the same CV would write the page twice. */}
      <div className="preview-dialog__body">{open ? children : null}</div>
    </dialog>
  );
}
