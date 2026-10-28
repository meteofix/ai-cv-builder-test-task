import { LIMITS, type CvDocument, type JobTarget } from '@cv/shared';
import { useState } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon } from '../components/Icon';
import { DateField } from './DateField';
import { formatRange } from './dates';
import { AddButton, IconButton, UpdatingLabel } from './fields';
import { newId } from './prepare';
import { useIsDesktop } from './useIsDesktop';

interface EducationCardProps {
  index: number;
  count: number;
  itemId: string;
  open: boolean;
  updating: boolean;
  onMove: (to: number) => void;
  onRemove: () => void;
}

function EducationCard({
  index,
  count,
  itemId,
  open,
  updating,
  onMove,
  onRemove,
}: EducationCardProps) {
  const { register, control } = useFormContext<CvDocument>();
  const [degree, institution, start, end] = useWatch({
    control,
    name: [
      `education.${index}.degree`,
      `education.${index}.institution`,
      `education.${index}.start`,
      `education.${index}.end`,
    ],
  });
  const dates = formatRange(start, end);

  return (
    <details
      className={updating ? 'entry-card entry-card--updating' : 'entry-card'}
      id={`item-${itemId}`}
      open={open || undefined}
      aria-busy={updating || undefined}
    >
      <summary className="entry-card__summary">
        <span className="entry-card__heading">
          <span className="entry-card__title">
            {[degree, institution].find(Boolean) ?? 'New education entry'}
          </span>
          <span className="entry-card__org">{degree ? institution : ''}</span>
          <span className="entry-card__dates">{dates || 'No dates'}</span>
        </span>
        {updating ? <UpdatingLabel /> : null}
        <Icon name="chevron" className="entry-card__chevron" />
      </summary>
      <div className="entry-card__body">
        <div className="entry-card__toolbar">
          <IconButton
            label="Move up"
            icon="up"
            variant="secondary"
            disabled={index === 0}
            onClick={() => {
              onMove(index - 1);
            }}
          />
          <IconButton
            label="Move down"
            icon="down"
            variant="secondary"
            disabled={index === count - 1}
            onClick={() => {
              onMove(index + 1);
            }}
          />
          <button type="button" className="btn btn--danger entry-card__remove" onClick={onRemove}>
            <Icon name="trash" />
            Remove
          </button>
        </div>
        <div className="field-grid">
          <label className="field">
            <span className="field__label">Degree</span>
            <input
              className="input"
              maxLength={LIMITS.maxFieldChars}
              {...register(`education.${index}.degree`)}
            />
          </label>
          <label className="field">
            <span className="field__label">Institution</span>
            <input
              className="input"
              maxLength={LIMITS.maxFieldChars}
              {...register(`education.${index}.institution`)}
            />
          </label>
        </div>
        {/* No "Present": the document stores only a start and an end for education. */}
        <div className="date-range">
          <DateField name={`education.${index}.start`} label="Start" />
          <DateField name={`education.${index}.end`} label="End" />
        </div>
      </div>
    </details>
  );
}

export function EducationSection({ target }: { target?: JobTarget | undefined }) {
  const { control } = useFormContext<CvDocument>();
  const { fields, append, move, remove } = useFieldArray({
    control,
    name: 'education',
    keyName: 'key',
  });
  const desktop = useIsDesktop();
  // The id, not the index: the list can change while the dialog is open.
  const [removing, setRemoving] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  return (
    <section className="form-section" id="section-education" aria-labelledby="education-title">
      <h2 className="form-section__title" id="education-title">
        Education
      </h2>
      <div className="form-section__list">
        {fields.map((field, index) => (
          <EducationCard
            key={field.key}
            index={index}
            count={fields.length}
            itemId={field.id}
            open={desktop || added === field.id}
            updating={target?.section === 'education' && target.itemId === field.id}
            onMove={(to) => {
              move(index, to);
            }}
            onRemove={() => {
              setRemoving(field.id);
            }}
          />
        ))}
      </div>
      <AddButton
        variant="secondary"
        disabled={fields.length >= LIMITS.maxEducation}
        onClick={() => {
          const id = newId();
          append({ id, institution: '', degree: '', start: null, end: null });
          setAdded(id);
        }}
      >
        Add education
      </AddButton>
      <ConfirmDialog
        open={removing !== null}
        title="Remove this education entry?"
        confirmLabel="Remove"
        onCancel={() => {
          setRemoving(null);
        }}
        onConfirm={() => {
          const index = fields.findIndex((field) => field.id === removing);
          if (index >= 0) remove(index);
          setRemoving(null);
        }}
      />
    </section>
  );
}
