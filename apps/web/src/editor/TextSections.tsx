import { LIMITS, type CvDocument } from '@cv/shared';
import type { ReactNode } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

/** The advice is a summary of about 400–600 characters; longer is allowed but marked. */
export const ADVISED_SUMMARY_CHARS = 600;

export function HeadlineSection({ updating }: { updating?: ReactNode }) {
  const { register } = useFormContext<CvDocument>();
  return (
    <section className="form-section" id="section-headline">
      <div className="form-section__head">
        <h2 className="form-section__title">
          <label htmlFor="field-headline">Headline</label>
        </h2>
        {updating}
      </div>
      <input
        id="field-headline"
        className="input"
        maxLength={LIMITS.maxFieldChars}
        {...register('headline')}
      />
    </section>
  );
}

export function SummarySection({ updating }: { updating?: ReactNode }) {
  const { register, control } = useFormContext<CvDocument>();
  const length = useWatch({ control, name: 'summary.text' }).length;
  const long = length > ADVISED_SUMMARY_CHARS;
  return (
    <section className="form-section" id="section-summary">
      <div className="form-section__head">
        <h2 className="form-section__title">
          <label htmlFor="field-summary">Summary</label>
        </h2>
        {updating}
      </div>
      {/* A textarea, not an input: the summary may have paragraphs, and their line breaks are kept. */}
      <textarea
        id="field-summary"
        className="textarea"
        rows={5}
        maxLength={LIMITS.maxSummaryChars}
        aria-describedby="summary-count"
        {...register('summary.text')}
      />
      <span id="summary-count" className={long ? 'char-count char-count--long' : 'char-count'}>
        {long
          ? `${length} characters — longer than the advised 400–600`
          : `${length} characters · 400–600 is advised`}
      </span>
    </section>
  );
}
