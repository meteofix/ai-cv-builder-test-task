# apps/web

React 19 single-page app built with Vite 8, styled with Tailwind 4, served by nginx behind the API's origin. Read the root `AGENTS.md` first.

## Rules

- Server state with TanStack Query; one react-hook-form form for the editor with `zodResolver` and the schemas of `@cv/shared`. No global store.
- All HTTP goes through the typed client built on the route table of `@cv/shared`. Map errors by their `code`, show the `requestId` on 5xx, and handle non-JSON errors from nginx (413, 502).
- Native elements first (`<dialog>`, `<details>`, `<select>`). English UI, no i18n. No rich text editor.
- Autosave is single-flight: one `PUT` at a time, changes made meanwhile go in the next one with the new `version`; the form is not reset after a successful save, only on a 409 conflict or after an AI job ends.
- Every screen works at 360 px without horizontal scroll, and with the keyboard.
- Tests use Testing Library and MSW handlers that follow `@cv/shared` contracts. Check pages in a real browser at 360 px when you change layout.

## Build setup is not yours

`package.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig*.json`, `Dockerfile` and `nginx.conf` change only through the user. The preview iframe needs the template fonts: `vite.config.ts` already serves them at `/fonts/*`.
