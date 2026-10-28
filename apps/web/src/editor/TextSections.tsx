import { LIMITS, type CvDocument } from '@cv/shared';
import type { ReactNode } from 'react';
import { useFormContext } from 'react-hook-form';

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
  const { register } = useFormContext<CvDocument>();
  return (
    <section className="form-section" id="section-summary">
      <div className="form-section__head">
        <h2 className="form-section__title">
          <label htmlFor="field-summary">Summary</label>
        </h2>
        {updating}
      </div>
      <textarea
        id="field-summary"
        className="textarea"
        rows={3}
        maxLength={LIMITS.maxSummaryChars}
        {...register('summary.text')}
      />
    </section>
  );
}
