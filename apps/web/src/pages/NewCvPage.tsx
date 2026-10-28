import { createCvFromTextRequestSchema, LIMITS, targetRoleSchema } from '@cv/shared';
import { useId, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { useCreateCv } from '../api/cvs';
import { errorMessage } from '../api/errors';
import { AppHeader } from '../components/AppHeader';
import { Spinner } from '../components/Icon';

type Tab = 'pdf' | 'text';
const TABS: readonly Tab[] = ['pdf', 'text'];
const TAB_LABELS: Record<Tab, string> = { pdf: 'Upload PDF', text: 'Paste text' };

const MAX_MB = LIMITS.maxPdfBytes / (1024 * 1024);

/** The checks the server repeats; running them first spares an upload that is certain to be refused. */
function pdfProblem(file: File): string | null {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) return 'This file is not a PDF.';
  if (file.size > LIMITS.maxPdfBytes) return `The file is too large (max ${MAX_MB} MB).`;
  return null;
}

const textSchema = createCvFromTextRequestSchema.shape.text;

export function NewCvPage() {
  const navigate = useNavigate();
  const create = useCreateCv();
  const ids = useId();
  const [tab, setTab] = useState<Tab>('pdf');
  const [role, setRole] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ role?: string; text?: string; file?: string }>({});
  const fileMessage = fileError ?? errors.file;

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0] ?? null;
    setFile(chosen);
    setFileError(chosen ? pdfProblem(chosen) : null);
    setErrors((previous) => ({ ...previous, file: undefined }));
  };

  const selectTab = (value: Tab) => {
    setTab(value);
    // A refusal for one source says nothing about the other.
    create.reset();
  };

  // Roving tabindex: the tab list is one stop, the arrow keys move between its tabs.
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + 1) % TABS.length] ?? 'pdf';
    selectTab(next);
    document.getElementById(`${ids}-tab-${next}`)?.focus();
  };

  const submit = () => {
    const next: typeof errors = {};
    const targetRole = targetRoleSchema.safeParse(role);
    if (!targetRole.success) next.role = 'Enter the role you are applying for.';
    if (tab === 'pdf' && !file) next.file = 'Choose a PDF file.';
    if (tab === 'text' && !textSchema.safeParse(text).success) {
      next.text =
        text.trim().length > LIMITS.maxSourceChars
          ? `The text is too long (max ${LIMITS.maxSourceChars} characters).`
          : 'Paste the text of your CV.';
    }
    setErrors(next);
    if (!targetRole.success || Object.keys(next).length > 0) return;
    if (tab === 'pdf' && (fileError || !file)) return;

    const input =
      tab === 'pdf' && file
        ? { kind: 'pdf' as const, targetRole: targetRole.data, file }
        : { kind: 'text' as const, targetRole: targetRole.data, text: text.trim() };
    create.mutate(input, { onSuccess: (created) => void navigate(`/cvs/${created.cvId}`) });
  };

  return (
    <>
      <AppHeader />
      <main className="page">
        <h1 className="page__title">New CV</h1>
        <form
          className="form-card"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="field">
            <label className="field__label" htmlFor={`${ids}-role`}>
              Target role
            </label>
            <input
              id={`${ids}-role`}
              className="input"
              value={role}
              maxLength={LIMITS.maxTargetRoleChars}
              aria-required="true"
              aria-invalid={errors.role ? true : undefined}
              aria-describedby={errors.role ? `${ids}-role-error` : undefined}
              onChange={(event) => {
                setRole(event.target.value);
                setErrors((previous) => ({ ...previous, role: undefined }));
              }}
            />
            {errors.role ? (
              <span className="field__error" id={`${ids}-role-error`}>
                {errors.role}
              </span>
            ) : null}
          </div>

          <div className="tabs" role="tablist" aria-label="CV source">
            {TABS.map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                id={`${ids}-tab-${value}`}
                aria-selected={tab === value}
                aria-controls={`${ids}-panel-${value}`}
                tabIndex={tab === value ? 0 : -1}
                className="tabs__tab"
                onClick={() => {
                  selectTab(value);
                }}
                onKeyDown={onTabKey}
              >
                {TAB_LABELS[value]}
              </button>
            ))}
          </div>

          {/* Both panels stay mounted: switching tabs must not drop the chosen file or the typed text. */}
          <div
            className="field"
            role="tabpanel"
            id={`${ids}-panel-pdf`}
            aria-labelledby={`${ids}-tab-pdf`}
            hidden={tab !== 'pdf'}
          >
            <label className="field__label" htmlFor={`${ids}-file`}>
              PDF file
            </label>
            <input
              id={`${ids}-file`}
              className="input"
              type="file"
              accept="application/pdf,.pdf"
              aria-invalid={fileMessage ? true : undefined}
              aria-describedby={`${ids}-file-hint${fileMessage ? ` ${ids}-file-error` : ''}`}
              onChange={onFile}
            />
            <span className="field__hint" id={`${ids}-file-hint`}>
              PDF with selectable text, up to {MAX_MB} MB.
            </span>
            {fileMessage ? (
              <span className="field__error" id={`${ids}-file-error`}>
                {fileMessage}
              </span>
            ) : null}
          </div>
          <div
            className="field"
            role="tabpanel"
            id={`${ids}-panel-text`}
            aria-labelledby={`${ids}-tab-text`}
            hidden={tab !== 'text'}
          >
            <label className="field__label" htmlFor={`${ids}-text`}>
              CV text
            </label>
            <textarea
              id={`${ids}-text`}
              className="textarea"
              rows={10}
              value={text}
              aria-invalid={errors.text ? true : undefined}
              aria-describedby={errors.text ? `${ids}-text-error` : undefined}
              onChange={(event) => {
                setText(event.target.value);
                setErrors((previous) => ({ ...previous, text: undefined }));
              }}
            />
            {errors.text ? (
              <span className="field__error" id={`${ids}-text-error`}>
                {errors.text}
              </span>
            ) : null}
          </div>

          {create.isError ? (
            <p className="auth__error" role="alert">
              {errorMessage(create.error)}
            </p>
          ) : null}
          <button type="submit" className="btn btn--primary" disabled={create.isPending}>
            {create.isPending ? <Spinner /> : null}
            Create CV
          </button>
        </form>
      </main>
    </>
  );
}
