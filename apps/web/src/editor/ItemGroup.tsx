import { LIMITS, type CvDocument } from '@cv/shared';
import { useRef, useState, type ReactNode } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { IconButton } from './fields';

/** Every list of groups in the document: skills, the bullets of a position, the lines of an extra entry. */
export type TextGroupsPath =
  `experience.${number}.groups` | `additional.${number}.entries.${number}.groups`;
type TitlePath = `skills.${number}.title` | `${TextGroupsPath}.${number}.title`;

interface ItemGroupProps {
  /** Names the group for assistive technology and its buttons: "Group 2", "Subsection 1". */
  label: string;
  titleName: TitlePath;
  titlePlaceholder: string;
  /**
   * A group without a title is a plain list, the usual case for bullets: its title field waits behind
   * "Add a subsection title" instead of sitting empty above every list.
   */
  optionalTitle?: boolean;
  /** Show the title field at once, for a group just added. */
  revealTitle?: boolean;
  removable?: boolean;
  onRemove: () => void;
  children: ReactNode;
}

/**
 * The one building block of the lists of the editor (decision 036): a group's title and its items, which
 * the caller renders (one comma-separated line of skills, or rows of bullets or lines). A blank title is no
 * title, so the group is a plain list again.
 */
export function ItemGroup({
  label,
  titleName,
  titlePlaceholder,
  optionalTitle = false,
  revealTitle = false,
  removable = true,
  onRemove,
  children,
}: ItemGroupProps) {
  const { register, control } = useFormContext<CvDocument>();
  // The paths differ only in where the group sits; the title field is the same in each of them.
  const name = titleName as 'skills.0.title';
  const title = useWatch({ control, name });
  // Once shown, the field stays while the person clears it: hiding it mid-edit would lose the focus.
  const [revealed, setRevealed] = useState(revealTitle);
  const focusNext = useRef(false);
  const shown = !optionalTitle || revealed || title !== null;
  const { ref, ...field } = register(name, {
    setValueAs: (value: string | null) => (value?.trim() ? value : null),
  });

  return (
    <div className="item-group" role="group" aria-label={label}>
      <div className="item-group__head">
        {shown ? (
          <label className="field item-group__title">
            <span className="field__label">{label} title</span>
            <input
              className="input"
              placeholder={titlePlaceholder}
              maxLength={LIMITS.maxFieldChars}
              ref={(element) => {
                ref(element);
                if (element && focusNext.current) {
                  focusNext.current = false;
                  element.focus();
                }
              }}
              {...field}
            />
          </label>
        ) : (
          <button
            type="button"
            className="btn btn--link item-group__add-title"
            onClick={() => {
              focusNext.current = true;
              setRevealed(true);
            }}
          >
            Add a subsection title
          </button>
        )}
        {removable ? (
          <IconButton icon="close" label={`Remove ${label.toLowerCase()}`} onClick={onRemove} />
        ) : null}
      </div>
      {children}
    </div>
  );
}
