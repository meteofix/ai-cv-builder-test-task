import type { Locale } from '@cv/shared';

export interface Labels {
  summary: string;
  experience: string;
  education: string;
  skills: string;
  present: string;
}

export const LABELS: Record<Locale, Labels> = {
  en: {
    summary: 'Summary',
    experience: 'Experience',
    education: 'Education',
    skills: 'Skills',
    present: 'Present',
  },
  uk: {
    summary: 'Про мене',
    experience: 'Досвід роботи',
    education: 'Освіта',
    skills: 'Навички',
    present: 'дотепер',
  },
};
