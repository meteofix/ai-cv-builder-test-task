import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { cvDocumentSchema, type CvDetail, type CvDocument } from '@cv/shared';
import { useEffect, useRef, useState } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { useBlocker } from 'react-router';
import { isJobActive, useJob } from '../api/cvs';
import { useNotInCv } from '../api/questions';
import { errorMessage } from '../api/errors';
import { queryKeys } from '../api/keys';
import { AppHeader } from '../components/AppHeader';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CvPreview } from '../components/CvPreview';
import { LanguageBadge } from '../components/LanguageBadge';
import { AdditionalSection } from './AdditionalSection';
import { ContactsSection } from './ContactsSection';
import { EducationSection } from './EducationSection';
import { ExperienceSection } from './ExperienceSection';
import { NotInCvPanel } from './NotInCvPanel';
import { PageCount } from './PageCount';
import { PdfButton } from './PdfButton';
import { PreviewDialog } from './PreviewDialog';
import { prepareDocument } from './prepare';
import { QuestionsBlock } from './QuestionsBlock';
import { SectionBar } from './SectionBar';
import { SaveStatus } from './SaveStatus';
import { SkillsSection } from './SkillsSection';
import { HeadlineSection, SummarySection } from './TextSections';
import { UpdatingLabel } from './fields';
import { useAutosave } from './useAutosave';
import { useIsDesktop } from './useIsDesktop';

/** The latest job of the CV: while it is active the editor is read-only and the job is asked about every 1.5 s. */
function useLatestJob(cv: CvDetail) {
  const client = useQueryClient();
  const active = isJobActive(cv.job);
  const polled = useJob(cv.id, active, cv.job);
  // The cache of the job may hold an earlier job of this CV (the generation): only its own answer counts.
  const answer = polled.data?.id === cv.job?.id ? polled.data : undefined;
  const job = answer ?? cv.job;
  const ended = active && answer !== undefined && !isJobActive(answer);

  // The job writes the document when it ends: fetch the CV, and the form follows (see the effect below).
  useEffect(() => {
    if (!ended) return;
    void client.invalidateQueries({ queryKey: queryKeys.cv(cv.id) });
    // An answer can move text out of the CV or back in.
    void client.invalidateQueries({ queryKey: queryKeys.notInCv(cv.id) });
  }, [ended, client, cv.id]);
  return job;
}

export function CvEditor({ cv, document }: { cv: CvDetail; document: CvDocument }) {
  const form = useForm<CvDocument>({
    resolver: zodResolver(cvDocumentSchema),
    defaultValues: document,
    mode: 'onChange',
  });
  const { saver, status, notice } = useAutosave({
    cvId: cv.id,
    form,
    document,
    version: cv.version,
  });
  const client = useQueryClient();
  const [leaveAsk, setLeaveAsk] = useState(false);
  // Leaving the editor with edits the server does not have first tries to save them; when that cannot be
  // done the person decides. After the session has ended there is nobody to save for: no questions asked.
  const blocker = useBlocker(
    () => saver.hasUnsaved() && client.getQueryData(queryKeys.me) !== null,
  );
  // The newest blocker: a second navigation may be blocked while the first flush is still running.
  const latestBlocker = useRef(blocker);
  useEffect(() => {
    latestBlocker.current = blocker;
  });
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void saver.flush().then((result) => {
      const current = latestBlocker.current;
      if (current.state !== 'blocked') return;
      if (client.getQueryData(queryKeys.me) === null || result === 'saved') current.proceed();
      // A conflict loaded the server's document: stay, where the notice about it is.
      else if (result === 'replaced') current.reset();
      else setLeaveAsk(true);
    });
  }, [blocker, saver, client]);
  const job = useLatestJob(cv);
  // Editable again only when the refetched CV says so: until then the form still holds the old document.
  const readOnly = isJobActive(cv.job);
  const target = readOnly ? job?.target : undefined;

  // A newer version from the server (an AI job finished, another device saved): it replaces the form.
  useEffect(() => {
    if (cv.version > saver.currentVersion()) saver.adopt(document, cv.version);
  }, [cv.version, document, saver]);

  const preview = prepareDocument(useWatch({ control: form.control }) as CvDocument);
  const updating = (section: string) => (target?.section === section ? <UpdatingLabel /> : null);
  const notInCv = useNotInCv(cv.id);
  const desktop = useIsDesktop();
  const [previewOpen, setPreviewOpen] = useState(false);
  // Measured by the preview, so known on a phone once the preview has been opened.
  const [pages, setPages] = useState<number | null>(null);
  // The dialog only exists on a phone: a resize to desktop closes it, so it does not reopen by itself later.
  if (desktop && previewOpen) setPreviewOpen(false);
  // A save pending or an AI job running: the PDF would be of a document that is about to change.
  const pdfBlocked = readOnly || status !== 'saved';
  const pdf = <PdfButton cvId={cv.id} disabled={pdfBlocked} />;

  return (
    <>
      <AppHeader
        role={cv.targetRole}
        badge={<LanguageBadge locale={document.locale} />}
        actions={
          desktop ? (
            <>
              <SaveStatus status={status} />
              {pdf}
            </>
          ) : undefined
        }
        isStatic={!desktop}
        beforeLogout={async () => (await saver.flush()) === 'saved'}
      />
      <ConfirmDialog
        open={leaveAsk}
        title="Leave without saving?"
        message="Your latest changes could not be saved."
        confirmLabel="Leave"
        // The dialog also calls `onCancel` when it closes after a confirm; by then the blocker is no longer
        // `blocked`, so the check keeps that call harmless.
        onCancel={() => {
          setLeaveAsk(false);
          if (blocker.state === 'blocked') blocker.reset();
        }}
        onConfirm={() => {
          setLeaveAsk(false);
          if (blocker.state === 'blocked') blocker.proceed();
        }}
      />
      {desktop ? null : <SectionBar questions={cv.questions} />}
      <div className="editor">
        <FormProvider {...form}>
          <form
            className="editor__form"
            aria-label="CV"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            <fieldset className="editor__fieldset" disabled={readOnly}>
              <legend className="sr-only">CV</legend>
              {notice ? (
                <p className="alert" role="status">
                  {notice}
                </p>
              ) : null}
              {notInCv.data?.sourceCoverage?.low ? (
                <p className="alert" role="status">
                  <span>
                    Part of your CV could not be read. Check{' '}
                    <a href="#section-not-in-cv" onClick={openNotInCv}>
                      Not in your CV
                    </a>
                    , or paste the text of your CV instead.
                  </span>
                </p>
              ) : null}
              <QuestionsBlock
                cvId={cv.id}
                questions={cv.questions}
                flush={async () => (await saver.flush()) === 'saved'}
                compact={!desktop}
              />
              <ContactsSection updating={updating('contacts')} />
              <HeadlineSection updating={updating('headline')} />
              <SummarySection updating={updating('summary')} />
              {notInCv.data?.orderReason ? (
                <p className="order-note" role="note">
                  <strong>Order of your experience:</strong> {notInCv.data.orderReason}
                </p>
              ) : null}
              <ExperienceSection target={target} />
              <EducationSection target={target} />
              <SkillsSection updating={updating('skills')} />
              <AdditionalSection target={target} />
              {notInCv.isError ? (
                <p className="field__error" role="alert">
                  {errorMessage(notInCv.error)}
                </p>
              ) : null}
              <NotInCvPanel items={notInCv.data?.items ?? []} />
            </fieldset>
          </form>
        </FormProvider>
        {desktop ? (
          <aside className="preview" aria-label="Preview">
            <div className="preview__head">
              <h2 className="preview__title">Preview</h2>
              <PageCount pages={pages} />
              <span className="badge">A4</span>
            </div>
            {/* It scrolls on its own; Safari does not focus a scroller, so the keyboard needs the tab stop. */}
            <div className="preview__frame" tabIndex={0} role="region" aria-label="CV preview">
              <CvPreview document={preview} onPages={setPages} />
            </div>
          </aside>
        ) : null}
      </div>
      {desktop ? null : (
        <>
          <div className="action-bar">
            <SaveStatus status={status} />
            <button
              type="button"
              className="btn btn--secondary"
              aria-haspopup="dialog"
              onClick={() => {
                setPreviewOpen(true);
              }}
            >
              Preview
            </button>
            {pdf}
          </div>
          <PreviewDialog
            open={previewOpen}
            onClose={() => {
              setPreviewOpen(false);
            }}
          >
            <PageCount pages={pages} />
            <CvPreview document={preview} onPages={setPages} />
          </PreviewDialog>
        </>
      )}
    </>
  );
}

/** A fragment link does not open a closed `<details>`: open the panel, then let the link scroll to it. */
function openNotInCv(): void {
  const panel = document.getElementById('section-not-in-cv');
  if (panel instanceof HTMLDetailsElement) panel.open = true;
}
