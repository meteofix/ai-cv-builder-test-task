import type { Locale } from '@cv/shared';

const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', uk: 'Ukrainian' };

/** The language of the CV, which follows its source and is not chosen by the person. */
export function LanguageBadge({ locale }: { locale: Locale }) {
  return <span className="badge">CV language: {LANGUAGE_NAMES[locale]}</span>;
}
