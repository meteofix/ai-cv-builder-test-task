import type { CvDocument, Locale } from '@cv/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { fontFaceCss, type FontSource } from './fonts.js';
import { LABELS } from './labels.js';
import { CV_CSS } from './styles.js';

export interface RenderCvHtmlOptions {
  fonts: FontSource;
}

function dateRange(
  start: string | null | undefined,
  end: string | null | undefined,
  current: boolean,
  present: string,
) {
  const to = current ? present : end;
  if (!start && !to) return '';
  return [start, to].filter(Boolean).join(' – ');
}

function CvBody({ document }: { document: CvDocument }) {
  const labels = LABELS[document.locale];
  const { contacts } = document;
  const contactItems = [contacts.email, contacts.phone, contacts.location, ...contacts.links];

  return (
    <main className="cv">
      <header className="cv-header">
        <h1 className="cv-name">{contacts.fullName}</h1>
        <p className="cv-headline">{document.headline}</p>
        <ul className="cv-contacts">
          {contactItems.filter(Boolean).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </header>
      {document.summary.text && (
        <section className="cv-section cv-section--summary">
          <h2 className="cv-section__title">{labels.summary}</h2>
          <p className="cv-summary">{document.summary.text}</p>
        </section>
      )}
      {document.experience.length > 0 && (
        <section className="cv-section cv-section--experience">
          <h2 className="cv-section__title">{labels.experience}</h2>
          {document.experience.map((position) => (
            <article className="cv-entry" key={position.id}>
              <div className="cv-entry__head">
                <h3 className="cv-entry__title">{position.title}</h3>
                <span className="cv-entry__dates">
                  {dateRange(position.start, position.end, position.current, labels.present)}
                </span>
              </div>
              <p className="cv-entry__meta">
                <span className="cv-entry__org">{position.company}</span>
                <span className="cv-entry__location">{position.location}</span>
              </p>
              <ul className="cv-entry__bullets">
                {position.bullets.map((bullet) => (
                  <li key={bullet.id}>{bullet.text}</li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      )}
      {document.education.length > 0 && (
        <section className="cv-section cv-section--education">
          <h2 className="cv-section__title">{labels.education}</h2>
          {document.education.map((entry) => (
            <article className="cv-entry cv-entry--compact" key={entry.id}>
              <div className="cv-entry__head">
                <h3 className="cv-entry__title">{entry.degree}</h3>
                <span className="cv-entry__dates">
                  {dateRange(entry.start, entry.end, false, labels.present)}
                </span>
              </div>
              <p className="cv-entry__meta">
                <span className="cv-entry__org">{entry.institution}</span>
              </p>
            </article>
          ))}
        </section>
      )}
      {document.skills.length > 0 && (
        <section className="cv-section cv-section--skills">
          <h2 className="cv-section__title">{labels.skills}</h2>
          <ul className="cv-skills">
            {document.skills.map((skill) => (
              <li key={skill.id}>{skill.name}</li>
            ))}
          </ul>
        </section>
      )}
      {document.additional.map((section) => (
        <section className="cv-section cv-section--extra" key={section.id}>
          <h2 className="cv-section__title">{section.title}</h2>
          <ul className="cv-list">
            {section.items.map((item) => (
              <li key={item.id}>{item.text}</li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}

/** The inner HTML of `<body>`: what the live preview writes into its iframe on every edit. */
export function renderCvBody(document: CvDocument): string {
  return renderToStaticMarkup(<CvBody document={document} />);
}

/** A complete HTML page without content: the preview sets it once and then only swaps the body. */
export function renderCvShell(
  { fonts }: RenderCvHtmlOptions,
  lang: Locale = 'en',
  title = '',
): string {
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${fontFaceCss(fonts)}${CV_CSS}</style></head><body></body></html>`;
}

/** The complete page the PDF endpoint prints: shell plus body, `<title>` and `<html lang>` from the document. */
export function renderCvHtml(document: CvDocument, options: RenderCvHtmlOptions): string {
  const title = [document.contacts.fullName, document.headline].filter(Boolean).join(' — ');
  // A replacer function: a string replacement would expand `$&`, `$'` and `$$` found in the CV text.
  return renderCvShell(options, document.locale, title).replace(
    '<body></body>',
    () => `<body>${renderCvBody(document)}</body>`,
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
