import { z } from 'zod';

export const LOCALES = ['en', 'uk'] as const;
export const localeSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof localeSchema>;
