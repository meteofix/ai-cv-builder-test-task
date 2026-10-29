import type { UpdateDocumentRequest } from '@cv/shared';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PRINTABLE_HEIGHT_PX } from './editor/pages';
import { editorDocument } from './test/fixtures';
import { CV_ID, cvDetail, job, mockRoute, USER } from './test/mock-api';
import { renderApp } from './test/render';
import { server } from './test/server';

async function mountEditor() {
  const puts: UpdateDocumentRequest[] = [];
  server.use(
    mockRoute('me', () => USER),
    mockRoute('getCv', () => cvDetail({ document: editorDocument(), version: 3, job: job() })),
    mockRoute('getNotInCv', () => ({ items: [] })),
    mockRoute('updateDocument', ({ body }) => {
      const request = body as UpdateDocumentRequest;
      puts.push(request);
      return { document: request.document, version: request.version + 1 };
    }),
  );
  const view = renderApp(`/cvs/${CV_ID}`);
  await screen.findByLabelText('Headline');
  return { ...view, puts };
}

/**
 * jsdom lays nothing out: give the preview's A4 sheet (`.cv`) a height, as a browser would for this many
 * pages of text. The iframe has its own window, so its own element prototype.
 */
async function stubSheet(pages: number) {
  const frame = await vi.waitFor(() => {
    const found = document.querySelector('iframe');
    if (!found?.contentDocument?.querySelector('.cv')) throw new Error('No preview sheet yet');
    return found;
  });
  const view = frame.contentWindow as (Window & typeof globalThis) | null;
  if (!view) throw new Error('No preview window');
  const padding = ((2 * 17) / 25.4) * 96;
  Object.defineProperty(view.HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('cv')
        ? Math.round(pages * PRINTABLE_HEIGHT_PX - 40 + padding)
        : 0;
    },
  });
}

describe('page count', () => {
  it.each([
    [2, '2 pages', false],
    [3, '3 pages — recruiters usually advise up to 2', true],
  ])('a preview of %i pages shows "%s"', async (pages, label, warned) => {
    const { user } = await mountEditor();
    await stubSheet(pages);
    // The count follows the preview: the next edit measures the page again.
    await user.type(screen.getByLabelText('Headline'), '.');

    const count = await screen.findByText(label);
    expect(count.classList.contains('page-count--long')).toBe(warned);
    // A hint only: nothing is blocked.
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
  });
});

describe('summary', () => {
  it.each([
    [600, '600 characters · 400–600 is advised', false],
    [601, '601 characters — longer than the advised 400–600', true],
  ])('a summary of %i characters shows "%s"', async (length, label, warned) => {
    const { user } = await mountEditor();
    const summary = screen.getByLabelText('Summary');
    await user.clear(summary);
    await user.click(summary);
    await user.paste('a'.repeat(length));

    const count = screen.getByText(label);
    expect(count.classList.contains('char-count--long')).toBe(warned);
    expect(summary).toHaveAccessibleDescription(label);
  });

  it('keeps the line breaks between paragraphs, in the field and in the save', async () => {
    const { user, puts } = await mountEditor();
    const summary = screen.getByLabelText('Summary');
    await user.clear(summary);
    await user.type(summary, 'First paragraph.{Enter}{Enter}Second paragraph.');

    expect(summary).toHaveValue('First paragraph.\n\nSecond paragraph.');
    await vi.waitFor(
      () => {
        expect(puts.at(-1)?.document.summary.text).toBe('First paragraph.\n\nSecond paragraph.');
      },
      { timeout: 4000 },
    );
  });
});
