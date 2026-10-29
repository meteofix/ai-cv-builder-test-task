import { LIMITS, type CvDocument, type JobTarget } from '@cv/shared';
import { useState } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon } from '../components/Icon';
import { DateField } from './DateField';
import { formatRange } from './dates';
import { AddButton, IconButton, UpdatingLabel } from './fields';
import { newId } from './prepare';
import { TextGroups } from './TextGroups';
import { useIsDesktop } from './useIsDesktop';

interface PositionCardProps {
  index: number;
  count: number;
  /** The id of the position in the document. */
  itemId: string;
  open: boolean;
  updating: boolean;
  onMove: (to: number) => void;
  onRemove: () => void;
}

function PositionCard({
  index,
  count,
  itemId,
  open,
  updating,
  onMove,
  onRemove,
}: PositionCardProps) {
  const { register, setValue, control } = useFormContext<CvDocument>();
  const [title, company, start, end, current] = useWatch({
    control,
    name: [
      `experience.${index}.title`,
      `experience.${index}.company`,
      `experience.${index}.start`,
      `experience.${index}.end`,
      `experience.${index}.current`,
    ],
  });
  const dates = formatRange(start, end, current);

  return (
    <details
      className={updating ? 'entry-card entry-card--updating' : 'entry-card'}
      id={`item-${itemId}`}
      open={open || undefined}
      aria-busy={updating || undefined}
    >
      <summary className="entry-card__summary">
        <span className="entry-card__heading">
          <span className="entry-card__title">{title || 'New position'}</span>
          <span className="entry-card__org">{company}</span>
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
            <span className="field__label">Job title</span>
            <input
              className="input"
              maxLength={LIMITS.maxFieldChars}
              {...register(`experience.${index}.title`)}
            />
          </label>
          <label className="field">
            <span className="field__label">Company</span>
            <input
              className="input"
              maxLength={LIMITS.maxFieldChars}
              {...register(`experience.${index}.company`)}
            />
          </label>
          <label className="field field-grid__full">
            <span className="field__label">Location</span>
            <input
              className="input"
              maxLength={LIMITS.maxFieldChars}
              {...register(`experience.${index}.location`)}
            />
          </label>
        </div>
        <div className="date-range">
          <DateField name={`experience.${index}.start`} label="Start" />
          <DateField name={`experience.${index}.end`} label="End" disabled={current} />
          <label className="checkbox date-range__present">
            <input
              type="checkbox"
              {...register(`experience.${index}.current`, {
                onChange: (event: { target: { checked: boolean } }) => {
                  // "Present" and an end date exclude each other (the document schema says so).
                  if (event.target.checked) setValue(`experience.${index}.end`, null);
                },
              })}
            />
            Present
          </label>
        </div>
        <div className="field" role="group" aria-label="Bullets">
          <span className="field__label" aria-hidden="true">
            Bullets
          </span>
          <TextGroups name={`experience.${index}.groups`} kind="bullet" />
        </div>
      </div>
    </details>
  );
}

export function ExperienceSection({ target }: { target?: JobTarget | undefined }) {
  const { control } = useFormContext<CvDocument>();
  const { fields, append, move, remove } = useFieldArray({
    control,
    name: 'experience',
    keyName: 'key',
  });
  const desktop = useIsDesktop();
  // The id, not the index: the list can change while the dialog is open.
  const [removing, setRemoving] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  return (
    <section className="form-section" id="section-experience" aria-labelledby="experience-title">
      <h2 className="form-section__title" id="experience-title">
        Experience
      </h2>
      <div className="form-section__list">
        {fields.map((field, index) => (
          <PositionCard
            key={field.key}
            index={index}
            count={fields.length}
            itemId={field.id}
            open={desktop || added === field.id}
            updating={target?.section === 'experience' && target.itemId === field.id}
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
        disabled={fields.length >= LIMITS.maxExperience}
        onClick={() => {
          const id = newId();
          append({
            id,
            company: '',
            title: '',
            location: '',
            start: null,
            end: null,
            current: false,
            groups: [{ id: newId(), title: null, items: [] }],
          });
          setAdded(id);
        }}
      >
        Add position
      </AddButton>
      <ConfirmDialog
        open={removing !== null}
        title="Remove this position?"
        message="Its bullets go with it."
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
