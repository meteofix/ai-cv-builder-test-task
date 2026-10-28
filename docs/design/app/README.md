# UI reference

The look of the web app, made in Claude Design. **Behaviour and texts come from [`docs/specs/web.md`](../../specs/web.md); look, tokens and states come from this reference.** Where the two disagree, web.md wins for what the app does and says, this folder for how it looks. The CV itself (the A4 sheet) follows [`docs/design/cv-template/`](../cv-template/) and `@cv/cv-template`, not this folder.

## Files

| File | What it is |
| --- | --- |
| `interface-reference.pdf` | The visual reference: every screen and state, exported from the mock. Start here. |
| `cv-builder.css` | Design tokens (section 1) and component styles (sections 2–4), as they are. Section 5 "Spec chrome" styles the mock's own captions and frames; it is not part of the app and is not ported. |
| `cv-builder.dc.html` | The main frame: editor on desktop (1a), updating a card (1b), component states (1c), phone (2a, 2b), generation with the draft (3a), failed generation (3b). |
| `editor-form.dc.html` | Markup of the editor form: contacts, headline, summary, experience and education cards, skills, additional sections. |
| `cv-sheet.dc.html` | The preview sheet as the mock draws it (the app uses `renderCvBody` instead). |
| `cv-builder-print.dc.html` | The print layout the PDF was exported from. |

The `.dc.html` files are markup references, not pages to open: `sc-if`, `sc-for`, `{{ … }}`, `<x-dc>` and `<helmet>` are Claude Design template syntax, and the runtime scripts they load were not kept. Inside them other frames are referred to by their original names ("CV Builder", "Editor Form", "CV Sheet"), which are now `cv-builder`, `editor-form` and `cv-sheet`. The captions of the mock (the `spec__*` notes) are the designer's notes in Ukrainian; they are not product text.

## Porting rules

- **Tokens.** At the start of task 3.1, the custom properties of section 1 of `cv-builder.css` move into the Tailwind 4 theme (`@theme` in `apps/web/src/index.css`); components use the tokens only.
- **Breakpoints.** In the mock every frame is a size container, so `@container app (…)` stands in for viewport media queries. In the app use plain breakpoints: `lg` = 1024 px.
- **Font.** Only the local IBM Plex Sans served from `/fonts` (the same files as the CV template). No Google Fonts: the `<link>` tags to fonts.googleapis.com in the mock are the design tool's. IBM Plex Mono is not used; it appears only in the mock's captions.
- **Illustrative content.** The texts of "Not in your CV" items (`context`) and the notes under "Partially applied" / "Could not apply" (`applyNote`) are examples. In the app they come from the API; nothing is made up in the client. The same holds for all names, companies and bullets in the mock.
- **Education has no "Present".** The document schema stores only `start` and `end` for education, so the education date range has no "Present" checkbox, even where the mock draws one.
- **Removing a position, an education entry or an additional section** opens a `<dialog>` confirmation, like deleting a CV (see web.md); the mock shows only the "Remove" / "Remove section" button. Bullets, skills, links and single lines are removed at once.
- **Download PDF** is a button that fetches the file and shows errors (web.md), even where the mock draws a link.
