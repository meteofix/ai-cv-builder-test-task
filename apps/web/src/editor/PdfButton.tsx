import { useMutation } from '@tanstack/react-query';
import { downloadPdf } from '../api/client';
import { errorMessage } from '../api/errors';
import { Icon, Spinner } from '../components/Icon';

const REVOKE_DELAY_MS = 1000;

/** Hands a blob to the browser as a download; the object URL is released right after the click. */
function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // Some browsers start the download after the click returns: the URL must outlive it.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, REVOKE_DELAY_MS);
}

interface PdfButtonProps {
  cvId: string;
  /** A save is pending or an AI job is running: the PDF would be of a document that is about to change. */
  disabled: boolean;
}

export function PdfButton({ cvId, disabled }: PdfButtonProps) {
  const pdf = useMutation({
    mutationFn: async () => {
      const { blob, fileName } = await downloadPdf(cvId);
      saveBlob(blob, fileName);
    },
  });
  return (
    <>
      {pdf.isError ? (
        <span className="save-status save-status--failed pdf-error" role="alert">
          {errorMessage(pdf.error)}
        </span>
      ) : null}
      <button
        type="button"
        className="btn btn--primary"
        disabled={disabled || pdf.isPending}
        onClick={() => {
          pdf.mutate();
        }}
      >
        {pdf.isPending ? <Spinner /> : <Icon name="download" />}
        Download PDF
      </button>
    </>
  );
}
