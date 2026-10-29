import { NOT_IN_CV_REASONS, type CvDocument, type NotInCvItem } from '@cv/shared';
import { useRef, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { Icon } from '../components/Icon';
import { addFromPanel, shownInCv } from './addFromPanel';

const GROUP_TITLES: Record<NotInCvItem['reason'], string> = {
  not_included: 'Left out',
  not_placed: 'Not placed anywhere',
  ignored: 'Ignored (looked like an instruction)',
};

/**
 * What the generation left out of the CV and why, so nothing the person wrote disappears silently. "Add"
 * puts an item back word for word where it belongs; an item the CV already shows is not offered again.
 * Text that looked like an instruction to the model has no "Add". After "Add" the focus moves to the
 * panel's heading, since the item (and its button) leaves the list, and the result is announced.
 */
export function NotInCvPanel({ items }: { items: readonly NotInCvItem[] }) {
  const { control, getValues, setValue } = useFormContext<CvDocument>();
  const document = useWatch({ control }) as CvDocument;
  const heading = useRef<HTMLElement>(null);
  const [announced, setAnnounced] = useState('');
  const open = items.filter((item) => item.reason === 'ignored' || !shownInCv(document, item.text));
  if (open.length === 0) {
    return announced ? (
      <p className="sr-only" role="status">
        {announced}
      </p>
    ) : null;
  }
  // The section the item lands in is set like any edit, so autosave saves it.
  const add = (item: NotInCvItem) => {
    const before = getValues();
    const after = addFromPanel(before, item);
    if (!after) return;
    for (const key of ['experience', 'summary', 'skills', 'additional'] as const) {
      if (after[key] !== before[key]) setValue(key, after[key], { shouldDirty: true });
    }
    setAnnounced('Added to your CV.');
    heading.current?.focus();
  };
  return (
    <details className="not-in-cv" id="section-not-in-cv">
      <summary className="not-in-cv__summary" ref={heading}>
        <span className="not-in-cv__title">Not in your CV</span>
        <span className="badge">{open.length}</span>
        <Icon name="chevron" className="entry-card__chevron" />
      </summary>
      <div className="not-in-cv__body">
        {NOT_IN_CV_REASONS.map((reason) => {
          const group = open.filter((item) => item.reason === reason);
          if (group.length === 0) return null;
          return (
            <section className="not-in-cv__group" key={reason}>
              <h3 className="not-in-cv__group-title">{GROUP_TITLES[reason]}</h3>
              <ul>
                {group.map((item, index) => (
                  // The same text can appear twice (a repeated footer line): the position is the identity.
                  <li className="not-in-cv__item" key={`${item.text}-${index}`}>
                    <span className="not-in-cv__text">{item.text}</span>
                    {item.context ? (
                      <span className="not-in-cv__context">{item.context}</span>
                    ) : null}
                    {reason === 'ignored' ? null : addFromPanel(document, item) ? (
                      <button
                        type="button"
                        className="btn btn--secondary not-in-cv__add"
                        aria-label={`Add: ${item.text}`}
                        onClick={() => {
                          add(item);
                        }}
                      >
                        Add
                      </button>
                    ) : (
                      <span className="not-in-cv__context">
                        No room left in your CV: copy it into a section by hand.
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <p className="sr-only" role="status">
        {announced}
      </p>
    </details>
  );
}
