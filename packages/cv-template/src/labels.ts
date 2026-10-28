import type { Locale } from '@cv/shared';

export interface Labels {
  summary: string;
  experience: string;
  education: string;
  skills: string;
  present: string;
  /** Month abbreviations, January first. */
  months: readonly string[];
}

export const LABELS: Record<Locale, Labels> = {
  en: {
    summary: 'Summary',
    experience: 'Experience',
    education: 'Education',
    skills: 'Skills',
    present: 'Present',
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  },
  uk: {
    summary: 'Про мене',
    experience: 'Досвід роботи',
    education: 'Освіта',
    skills: 'Навички',
    present: 'дотепер',
    // CLDR abbreviations without the trailing dot.
    months: [
      'січ',
      'лют',
      'бер',
      'квіт',
      'трав',
      'черв',
      'лип',
      'серп',
      'вер',
      'жовт',
      'лист',
      'груд',
    ],
  },
};
