import { LOCALES } from '@cv/shared';

/** Placeholder shell; task 3.1 replaces it with routing, the API client and the auth screens. */
export function App() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">AI CV Builder</h1>
      <p className="mt-2 text-sm text-gray-600">CV languages: {LOCALES.join(', ')}</p>
    </main>
  );
}
