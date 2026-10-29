import { Fragment } from 'react';
import { filled } from './text.js';

export interface Line {
  id: string;
  text: string;
}

/** A group of lines (decision 036): bullets of a position or lines of an extra entry. */
export interface LineGroup {
  id: string;
  title: string | null;
  items: readonly Line[];
}

/**
 * The groups that still have a line with text, each with only those lines. A titled group with no line
 * left is dropped too: its title alone would be a heading over nothing.
 */
export function visibleGroups(groups: readonly LineGroup[]): LineGroup[] {
  return groups
    .map((group) => ({ ...group, items: group.items.filter((line) => filled(line.text)) }))
    .filter((group) => group.items.length > 0);
}

/**
 * The lists of some groups in order. A titled group prints its title as a subheading right before its
 * list, so the text reads title, then its lines; a group without a title is the list alone.
 */
export function GroupLists({
  groups,
  listClass,
}: {
  groups: readonly LineGroup[];
  listClass: string;
}) {
  return groups.map((group) => (
    <Fragment key={group.id}>
      {filled(group.title) ? <h4 className="cv-entry__group-title">{group.title}</h4> : null}
      <ul className={listClass}>
        {group.items.map((line) => (
          <li key={line.id}>{line.text}</li>
        ))}
      </ul>
    </Fragment>
  ));
}
