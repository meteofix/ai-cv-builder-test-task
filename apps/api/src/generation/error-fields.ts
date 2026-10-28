/** What may be logged of an unexpected error: name, message, code and stack, as the global filter does. */
export function errorFields(error: unknown): Record<string, unknown> {
  // A thrown non-Error value could be anything, CV text included: only its type is logged.
  if (!(error instanceof Error)) return { name: 'NonError', type: typeof error };
  // Driver errors can carry row values (CV text) in other fields, so nothing else is copied.
  const code = (error as { code?: unknown }).code;
  return {
    name: error.name,
    message: error.message,
    ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
    stack: error.stack,
  };
}
