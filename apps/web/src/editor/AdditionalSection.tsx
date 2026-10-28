import { LIMITS, type CvDocument, type JobTarget } from '@cv/shared';
import { useState } from 'react';
import { useFieldArray, useFormContext } from 'react-hook-form';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon } from '../components/Icon';
import { AddButton, IconButton, UpdatingLabel } from './fields';
import { newId } from './prepare';

function ExtraSection({
  index,
  itemId,
  updating,
  onRemove,
}: {
  index: number;
  itemId: string;
  updating: boolean;
  onRemove: () => void;
}) {
  const { register, control } = useFormContext<CvDocument>();
  const lines = useFieldArray({ control, name: `additional.${index}.items`, keyName: 'key' });

  return (
    <div className="extra-section" id={`item-${itemId}`} aria-busy={updating || undefined}>
      {updating ? <UpdatingLabel /> : null}
      <label className="field">
        <span className="field__label">Section title</span>
        <input
          className="input"
          maxLength={LIMITS.maxFieldChars}
          {...register(`additional.${index}.title`)}
        />
      </label>
      <div className="field" role="group" aria-label="Lines">
        <span className="field__label" aria-hidden="true">
          Lines
        </span>
        <ul className="line-list">
          {lines.fields.map((line, lineIndex) => (
            <li className="line-row" key={line.key}>
              <input
                className="input"
                aria-label={`Line ${lineIndex + 1}`}
                maxLength={LIMITS.maxTextChars}
                {...register(`additional.${index}.items.${lineIndex}.text`)}
              />
              <IconButton
                label="Remove line"
                icon="close"
                onClick={() => {
                  lines.remove(lineIndex);
                }}
              />
            </li>
          ))}
        </ul>
      </div>
      <div className="question-card__actions">
        <AddButton
          disabled={lines.fields.length >= LIMITS.maxAdditionalItems}
          onClick={() => {
            lines.append({ id: newId(), text: '', factIds: [] });
          }}
        >
          Add line
        </AddButton>
        <button type="button" className="btn btn--danger entry-card__remove" onClick={onRemove}>
          <Icon name="trash" />
          Remove section
        </button>
      </div>
    </div>
  );
}

export function AdditionalSection({ target }: { target?: JobTarget | undefined }) {
  const { control } = useFormContext<CvDocument>();
  const { fields, append, remove } = useFieldArray({
    control,
    name: 'additional',
    keyName: 'key',
  });
  // The id, not the index: the list can change while the dialog is open.
  const [removing, setRemoving] = useState<string | null>(null);

  return (
    <section className="form-section" id="section-more" aria-labelledby="more-title">
      <h2 className="form-section__title" id="more-title">
        Additional sections
      </h2>
      {fields.map((field, index) => (
        <ExtraSection
          key={field.key}
          index={index}
          itemId={field.id}
          updating={target?.section === 'additional' && target.itemId === field.id}
          onRemove={() => {
            setRemoving(field.id);
          }}
        />
      ))}
      <AddButton
        variant="secondary"
        disabled={fields.length >= LIMITS.maxAdditionalSections}
        onClick={() => {
          append({ id: newId(), title: '', items: [] });
        }}
      >
        Add section
      </AddButton>
      <ConfirmDialog
        open={removing !== null}
        title="Remove this section?"
        message="All its lines go with it."
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
