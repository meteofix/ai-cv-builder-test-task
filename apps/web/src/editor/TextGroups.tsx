import { LIMITS, type CvDocument } from '@cv/shared';
import { useState } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { AddButton, IconButton } from './fields';
import { ItemGroup, type TextGroupsPath } from './ItemGroup';
import { newId } from './prepare';

/** What the rows of a list are: the bullets of a position, or the lines of an extra entry. */
const KINDS = {
  bullet: {
    item: 'Bullet',
    maxChars: LIMITS.maxBulletChars,
    maxTotal: LIMITS.maxBulletsPerPosition,
  },
  line: { item: 'Line', maxChars: LIMITS.maxTextChars, maxTotal: LIMITS.maxLinesPerEntry },
} as const;
type Kind = keyof typeof KINDS;

const emptyItem = () => ({ id: newId(), text: '', factIds: [] });

interface TextItemsProps {
  name: `${TextGroupsPath}.${number}.items`;
  kind: Kind;
  canAdd: boolean;
}

/** The rows of one group, each with ↑/↓ and remove. A row goes at once: it is one line of text. */
function TextItems({ name, kind, canAdd }: TextItemsProps) {
  const { register, control } = useFormContext<CvDocument>();
  // Bullets and lines have the same shape; the paths differ only in where the group sits.
  const path = name as 'experience.0.groups.0.items';
  const items = useFieldArray({ control, name: path, keyName: 'key' });
  const { item, maxChars } = KINDS[kind];
  const lower = item.toLowerCase();

  return (
    <>
      <ul className="item-list">
        {items.fields.map((row, index) => {
          const n = index + 1;
          const props = {
            'aria-label': `${item} ${n}`,
            maxLength: maxChars,
            ...register(`${path}.${index}.text`),
          };
          return (
            <li className="item-row" key={row.key}>
              {kind === 'bullet' ? (
                <textarea className="textarea textarea--bullet" rows={2} {...props} />
              ) : (
                <input className="input" {...props} />
              )}
              <span className="item-row__actions">
                <IconButton
                  label={`Move ${lower} ${n} up`}
                  icon="up"
                  disabled={index === 0}
                  onClick={() => {
                    items.move(index, index - 1);
                  }}
                />
                <IconButton
                  label={`Move ${lower} ${n} down`}
                  icon="down"
                  disabled={index === items.fields.length - 1}
                  onClick={() => {
                    items.move(index, index + 1);
                  }}
                />
                <IconButton
                  label={`Remove ${lower}`}
                  icon="close"
                  onClick={() => {
                    items.remove(index);
                  }}
                />
              </span>
            </li>
          );
        })}
      </ul>
      <AddButton
        disabled={!canAdd}
        onClick={() => {
          items.append(emptyItem());
        }}
      >
        Add {lower}
      </AddButton>
    </>
  );
}

/**
 * The groups of one list: a position's subsections of bullets, or an extra entry's groups of lines. One
 * untitled group is a plain list and looks like one; "Add subsection" starts another group. Removing a
 * group that still has text asks first, like removing a card.
 */
export function TextGroups({ name, kind }: { name: TextGroupsPath; kind: Kind }) {
  const { control } = useFormContext<CvDocument>();
  const path = name as 'experience.0.groups';
  const groups = useFieldArray({ control, name: path, keyName: 'key' });
  const values = useWatch({ control, name: path });
  // The id, not the index: the list can change while the dialog is open.
  const [removing, setRemoving] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const { item, maxTotal } = KINDS[kind];
  const total = values.reduce((sum, group) => sum + group.items.length, 0);
  const canAdd = total < maxTotal;
  const removeNow = (id: string) => {
    const index = groups.fields.findIndex((group) => group.id === id);
    if (index >= 0) groups.remove(index);
  };

  return (
    <div className="item-groups">
      {groups.fields.map((group, index) => {
        const value = values[index];
        return (
          <ItemGroup
            key={group.key}
            id={value?.id}
            label={`Subsection ${index + 1}`}
            titleName={`${path}.${index}.title`}
            titlePlaceholder="Optional, for example Platform"
            optionalTitle
            revealTitle={added === group.id}
            // The only group without a title is the plain list itself: its rows are removed one by one.
            removable={groups.fields.length > 1 || (value?.title ?? null) !== null}
            onRemove={() => {
              if (value?.items.some((row) => row.text.trim())) setRemoving(group.id);
              else removeNow(group.id);
            }}
          >
            <TextItems name={`${path}.${index}.items`} kind={kind} canAdd={canAdd} />
          </ItemGroup>
        );
      })}
      {groups.fields.length === 0 ? (
        <AddButton
          disabled={!canAdd}
          onClick={() => {
            groups.append({ id: newId(), title: null, items: [emptyItem()] });
          }}
        >
          Add {item.toLowerCase()}
        </AddButton>
      ) : null}
      <AddButton
        disabled={!canAdd || groups.fields.length >= LIMITS.maxGroupsPerList}
        onClick={() => {
          const id = newId();
          groups.append({ id, title: null, items: [emptyItem()] });
          setAdded(id);
        }}
      >
        Add subsection
      </AddButton>
      <ConfirmDialog
        open={removing !== null}
        title="Remove this subsection?"
        message={`Its ${item.toLowerCase()}s go with it.`}
        confirmLabel="Remove"
        onCancel={() => {
          setRemoving(null);
        }}
        onConfirm={() => {
          if (removing) removeNow(removing);
          setRemoving(null);
        }}
      />
    </div>
  );
}
