import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { cvDocumentSchema, type CvDetail, type CvDocument } from '@cv/shared';
import { useEffect, useState } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { isJobActive, useJob } from '../api/cvs';
import { useNotInCv } from '../api/questions';
import { errorMessage } from '../api/errors';
import { queryKeys } from '../api/keys';
import { AppHeader } from '../components/AppHeader';
import { CvPreview } from '../components/CvPreview';
import { LanguageBadge } from '../components/LanguageBadge';
import { AdditionalSection } from './AdditionalSection';
import { ContactsSection } from './ContactsSection';
import { EducationSection } from './EducationSection';
import { ExperienceSection } from './ExperienceSection';
import { NotInCvPanel } from './NotInCvPanel';
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
  const polled = useJob(cv.id, active);
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
              <QuestionsBlock
                cvId={cv.id}
                questions={cv.questions}
                flush={() => saver.flush()}
                compact={!desktop}
              />
              <ContactsSection updating={updating('contacts')} />
              <HeadlineSection updating={updating('headline')} />
              <SummarySection updating={updating('summary')} />
              <ExperienceSection target={target} />
              <EducationSection target={target} />
              <SkillsSection updating={updating('skills')} />
              <AdditionalSection target={target} />
              {notInCv.isError ? (
                <p className="field__error" role="alert">
                  {errorMessage(notInCv.error)}
                </p>
              ) : null}
              <NotInCvPanel items={notInCv.data ?? []} />
            </fieldset>
          </form>
        </FormProvider>
        {desktop ? (
          <aside className="preview" aria-label="Preview">
            <div className="preview__head">
              <h2 className="preview__title">Preview</h2>
              <span className="badge">A4</span>
            </div>
            <div className="preview__frame">
              <CvPreview document={preview} />
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
            <CvPreview document={preview} />
          </PreviewDialog>
        </>
      )}
    </>
  );
}
