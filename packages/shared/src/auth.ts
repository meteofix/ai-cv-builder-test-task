import { z } from 'zod';
import { LIMITS } from './limits.js';

/** Emails are compared trimmed and lower-cased, so `A@x.com` and `a@x.com ` are one account. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(LIMITS.maxEmailChars)
  .pipe(z.email('Enter a valid email address'));

export const credentialsSchema = z.object({
  email: emailSchema,
  password: z.string().min(LIMITS.minPasswordChars).max(LIMITS.maxPasswordChars),
});
export type Credentials = z.infer<typeof credentialsSchema>;

export const userSchema = z.object({ id: z.uuid(), email: z.string() });
export type User = z.infer<typeof userSchema>;
