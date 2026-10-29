import { LIMITS, type CvDocument } from '@cv/shared';
import { useFormContext } from 'react-hook-form';
import { Icon } from '../components/Icon';
import { DateField } from './DateField';
import { IconButton, UpdatingLabel } from './fields';
import { TextGroups } from './TextGroups';

interface ExtraEntryProps {
  section: number;
  index: number;
  count: number;
  /** The id of the entry in the document: a question about it scrolls here. */
  entryId: string;
  updating: boolean;
  onMove: (to: number) => void;
  onRemove: () => void;
}

/**
 * One record of an extra section — a project, a course, a certificate: an optional title and dates, and
 * its lines in groups. An entry with neither title nor dates is a plain list of lines ("Languages").
 */
export function ExtraEntry({
  section,
  index,
  count,
  entryId,
  updating,
  onMove,
  onRemove,
}: ExtraEntryProps) {
  const { register } = useFormContext<CvDocument>();
  const base = `additional.${section}.entries.${index}` as const;
  const n = index + 1;

  return (
    <div
      className="extra-entry"
      id={`item-${entryId}`}
      role="group"
      aria-label={`Entry ${n}`}
      aria-busy={updating || undefined}
    >
      <div className="entry-card__toolbar">
        <IconButton
          label="Move entry up"
          icon="up"
          variant="secondary"
          disabled={index === 0}
          onClick={() => {
            onMove(index - 1);
          }}
        />
        <IconButton
          label="Move entry down"
          icon="down"
          variant="secondary"
          disabled={index === count - 1}
          onClick={() => {
            onMove(index + 1);
          }}
        />
        {updating ? <UpdatingLabel /> : null}
        <button type="button" className="btn btn--danger entry-card__remove" onClick={onRemove}>
          <Icon name="trash" />
          Remove entry
        </button>
      </div>
      <label className="field">
        <span className="field__label">Entry {n} title</span>
        <input
          className="input"
          placeholder="Optional, for example a project or a course"
          maxLength={LIMITS.maxFieldChars}
          {...register(`${base}.title`)}
        />
      </label>
      <div className="date-range">
        <DateField name={`${base}.start`} label="Start" />
        <DateField name={`${base}.end`} label="End" />
      </div>
      <TextGroups name={`${base}.groups`} kind="line" />
    </div>
  );
}
