import { NOT_IN_CV_REASONS, type NotInCvItem } from '@cv/shared';
import { Icon } from '../components/Icon';

const GROUP_TITLES: Record<NotInCvItem['reason'], string> = {
  not_included: 'Left out',
  not_placed: 'Not placed anywhere',
  ignored: 'Ignored (looked like an instruction)',
};

/** What the generation left out of the CV and why, so nothing the person wrote disappears silently. */
export function NotInCvPanel({ items }: { items: readonly NotInCvItem[] }) {
  if (items.length === 0) return null;
  return (
    <details className="not-in-cv" id="section-not-in-cv">
      <summary className="not-in-cv__summary">
        <span className="not-in-cv__title">Not in your CV</span>
        <span className="badge">{items.length}</span>
        <Icon name="chevron" className="entry-card__chevron" />
      </summary>
      <div className="not-in-cv__body">
        {NOT_IN_CV_REASONS.map((reason) => {
          const group = items.filter((item) => item.reason === reason);
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
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </details>
  );
}
