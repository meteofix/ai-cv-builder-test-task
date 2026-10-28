import { linkSchema, type CvDocument, type Locale } from '@cv/shared';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fontFaceCss, type FontSource } from './fonts.js';
import { LABELS, type Labels } from './labels.js';
import { CV_CSS } from './styles.js';

export interface RenderCvHtmlOptions {
  fonts: FontSource;
}

/** Text counts as present only when it has something other than spaces (the editor can leave " " behind). */
const filled = (value: string | null | undefined): value is string => !!value?.trim();

/** `2021-03` → `Mar 2021`, `2021` → `2021`; anything else prints nothing. */
function formatDate(value: string | null | undefined, labels: Labels): string {
  if (!value) return '';
  const [year = '', month] = value.split('-');
  const name = month ? labels.months[Number(month) - 1] : undefined;
  return [name, year].filter(Boolean).join(' ');
}

/** `Mar 2023 – Present`; one known side prints alone, nothing known prints nothing. */
function dateRange(
  start: string | null | undefined,
  end: string | null | undefined,
  current: boolean,
  labels: Labels,
): string {
  return [formatDate(start, labels), current ? labels.present : formatDate(end, labels)]
    .filter(Boolean)
    .join(' – ');
}

/** The address of a link without its scheme and trailing slash: `https://github.com/x/` → `github.com/x`. */
function linkText(link: string): string {
  return link.replace(/^[a-z][a-z0-9+.-]*:(\/\/)?/i, '').replace(/\/+$/, '');
}

function ContactLink({ href, children }: { href: string; children: string }) {
  // The schemes the document schema allows: anything else is shown as text and never becomes a `href`.
  return linkSchema.safeParse(href).success ? <a href={href}>{children}</a> : <>{href}</>;
}

function contactItems({ email, phone, location, links }: CvDocument['contacts']) {
  const items: { key: string; node: ReactNode }[] = [];
  if (filled(email)) {
    items.push({
      key: 'email',
      node: <ContactLink href={`mailto:${email}`}>{email}</ContactLink>,
    });
  }
  if (filled(phone)) {
    const digits = phone.replace(/[^+\d]/g, '');
    items.push({
      key: 'phone',
      node: digits ? <ContactLink href={`tel:${digits}`}>{phone}</ContactLink> : phone,
    });
  }
  if (filled(location)) items.push({ key: 'location', node: location });
  links.forEach((link, index) => {
    if (filled(link)) {
      items.push({
        key: `link-${index}`,
        node: <ContactLink href={link}>{linkText(link)}</ContactLink>,
      });
    }
  });
  return items;
}

function Section({ kind, title, children }: { kind: string; title: string; children: ReactNode }) {
  return (
    <section className={`cv-section cv-section--${kind}`}>
      {filled(title) ? <h2 className="cv-section__title">{title}</h2> : null}
      {children}
    </section>
  );
}

interface EntryProps {
  id: string;
  title: string;
  dates: string;
  org?: string;
  location?: string | undefined;
  compact?: boolean;
  bullets?: readonly { id: string; text: string }[];
}

/** The lines of an entry that have text; an entry with none of them is not rendered at all. */
const bulletLines = (entry: EntryProps) =>
  (entry.bullets ?? []).filter((bullet) => filled(bullet.text));
const hasContent = (entry: EntryProps): boolean =>
  [entry.title, entry.dates, entry.org, entry.location].some(filled) ||
  bulletLines(entry).length > 0;

function Entry({ title, dates, org, location, compact = false, ...rest }: EntryProps) {
  const lines = bulletLines({ title, dates, ...rest });
  return (
    <article className={compact ? 'cv-entry cv-entry--compact' : 'cv-entry'}>
      {filled(title) || filled(dates) ? (
        <div className="cv-entry__head">
          {filled(title) ? <h3 className="cv-entry__title">{title}</h3> : null}
          {filled(dates) ? <span className="cv-entry__dates">{dates}</span> : null}
        </div>
      ) : null}
      {filled(org) || filled(location) ? (
        <p className="cv-entry__meta">
          {filled(org) ? <span className="cv-entry__org">{org}</span> : null}
          {filled(location) ? <span className="cv-entry__location">{location}</span> : null}
        </p>
      ) : null}
      {lines.length > 0 ? (
        <ul className="cv-entry__bullets">
          {lines.map((bullet) => (
            <li key={bullet.id}>{bullet.text}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function CvBody({ document }: { document: CvDocument }) {
  const labels = LABELS[document.locale];
  const { contacts, headline, summary } = document;
  const contactList = contactItems(contacts);
  const positions = document.experience
    .map((position) => ({
      id: position.id,
      title: position.title,
      dates: dateRange(position.start, position.end, position.current, labels),
      org: position.company,
      location: position.location,
      bullets: position.bullets,
    }))
    .filter(hasContent);
  const schools = document.education
    .map((entry) => ({
      id: entry.id,
      compact: true,
      // Without a degree the institution is the title and there is no meta line.
      title: filled(entry.degree) ? entry.degree : entry.institution,
      dates: dateRange(entry.start, entry.end, false, labels),
      org: filled(entry.degree) ? entry.institution : '',
    }))
    .filter(hasContent);
  const skills = document.skills.filter((skill) => filled(skill.name));

  return (
    <main className="cv">
      {filled(contacts.fullName) || filled(headline) || contactList.length > 0 ? (
        <header className="cv-header">
          {filled(contacts.fullName) ? <h1 className="cv-name">{contacts.fullName}</h1> : null}
          {filled(headline) ? <p className="cv-headline">{headline}</p> : null}
          {contactList.length > 0 ? (
            <ul className="cv-contacts">
              {contactList.map((item) => (
                <li key={item.key}>{item.node}</li>
              ))}
            </ul>
          ) : null}
        </header>
      ) : null}
      {filled(summary.text) ? (
        <Section kind="summary" title={labels.summary}>
          <p className="cv-summary">{summary.text}</p>
        </Section>
      ) : null}
      {positions.length > 0 ? (
        <Section kind="experience" title={labels.experience}>
          {positions.map((position) => (
            <Entry key={position.id} {...position} />
          ))}
        </Section>
      ) : null}
      {schools.length > 0 ? (
        <Section kind="education" title={labels.education}>
          {schools.map((entry) => (
            <Entry key={entry.id} {...entry} />
          ))}
        </Section>
      ) : null}
      {skills.length > 0 ? (
        <Section kind="skills" title={labels.skills}>
          <ul className="cv-skills">
            {skills.map((skill) => (
              <li key={skill.id}>{skill.name}</li>
            ))}
          </ul>
        </Section>
      ) : null}
      {document.additional.map((section) => {
        const items = section.items.filter((item) => filled(item.text));
        return items.length > 0 ? (
          <Section kind="extra" title={section.title} key={section.id}>
            <ul className="cv-list">
              {items.map((item) => (
                <li key={item.id}>{item.text}</li>
              ))}
            </ul>
          </Section>
        ) : null;
      })}
    </main>
  );
}

/** The inner HTML of `<body>`: what the live preview writes into its iframe on every edit. */
export function renderCvBody(document: CvDocument): string {
  return renderToStaticMarkup(<CvBody document={document} />);
}

/** The page around a body; the body is concatenated, never passed to `replace`, which would expand `$&` and `$'` in the CV text. */
function page({ fonts }: RenderCvHtmlOptions, lang: Locale, title: string, body: string): string {
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${fontFaceCss(fonts)}${CV_CSS}</style></head><body>${body}</body></html>`;
}

/** A complete HTML page without content: the preview sets it once and then only swaps the body. */
export function renderCvShell(
  options: RenderCvHtmlOptions,
  lang: Locale = 'en',
  title = '',
): string {
  return page(options, lang, title, '');
}

/** The complete page the PDF endpoint prints: shell plus body, `<title>` and `<html lang>` from the document. */
export function renderCvHtml(document: CvDocument, options: RenderCvHtmlOptions): string {
  const title = [document.contacts.fullName, document.headline].filter(Boolean).join(' — ');
  return page(options, document.locale, title, renderCvBody(document));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
