import { LIMITS, type CvDocument, type CvEntry, type JobTarget } from '@cv/shared';
import { useState } from 'react';
import { useFieldArray, useFormContext } from 'react-hook-form';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon } from '../components/Icon';
import { ExtraEntry } from './ExtraEntry';
import { AddButton, UpdatingLabel } from './fields';
import { newId } from './prepare';
import { concerns } from './showInCv';

/** A new entry starts with one empty group, so its first line can be added at once. */
const newEntry = (): CvEntry => ({
  id: newId(),
  title: '',
  start: null,
  end: null,
  groups: [{ id: newId(), title: null, items: [] }],
});

function ExtraSection({
  index,
  itemId,
  target,
  onRemove,
}: {
  index: number;
  itemId: string;
  target?: JobTarget | undefined;
  onRemove: () => void;
}) {
  const { register, control } = useFormContext<CvDocument>();
  const entries = useFieldArray({ control, name: `additional.${index}.entries`, keyName: 'key' });
  // The id, not the index: the list can change while the dialog is open.
  const [removing, setRemoving] = useState<string | null>(null);
  const updating = (id: string) => target?.section === 'additional' && target.itemId === id;

  return (
    <div className="extra-section" id={`item-${itemId}`} aria-busy={updating(itemId) || undefined}>
      {updating(itemId) ? <UpdatingLabel /> : null}
      <label className="field">
        <span className="field__label">Section title</span>
        <input
          className="input"
          maxLength={LIMITS.maxFieldChars}
          {...register(`additional.${index}.title`)}
        />
      </label>
      {entries.fields.map((entry, entryIndex) => (
        <ExtraEntry
          key={entry.key}
          section={index}
          index={entryIndex}
          count={entries.fields.length}
          entryId={entry.id}
          updating={concerns(target, 'additional', entry.id)}
          onMove={(to) => {
            entries.move(entryIndex, to);
          }}
          onRemove={() => {
            setRemoving(entry.id);
          }}
        />
      ))}
      <div className="question-card__actions">
        <AddButton
          disabled={entries.fields.length >= LIMITS.maxAdditionalItems}
          onClick={() => {
            entries.append(newEntry());
          }}
        >
          Add entry
        </AddButton>
        <button type="button" className="btn btn--danger entry-card__remove" onClick={onRemove}>
          <Icon name="trash" />
          Remove section
        </button>
      </div>
      <ConfirmDialog
        open={removing !== null}
        title="Remove this entry?"
        message="Its lines go with it."
        confirmLabel="Remove"
        onCancel={() => {
          setRemoving(null);
        }}
        onConfirm={() => {
          const at = entries.fields.findIndex((entry) => entry.id === removing);
          if (at >= 0) entries.remove(at);
          setRemoving(null);
        }}
      />
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
          target={target}
          onRemove={() => {
            setRemoving(field.id);
          }}
        />
      ))}
      <AddButton
        variant="secondary"
        disabled={fields.length >= LIMITS.maxAdditionalSections}
        onClick={() => {
          append({ id: newId(), title: '', entries: [newEntry()] });
        }}
      >
        Add section
      </AddButton>
      <ConfirmDialog
        open={removing !== null}
        title="Remove this section?"
        message="All its entries go with it."
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
