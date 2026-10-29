import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { editorDocument } from './test/fixtures';
import { CV_ID, cvDetail, mockRoute, USER } from './test/mock-api';
import { renderApp } from './test/render';
import { server } from './test/server';

describe('Preview (docs/specs/web.md, item 11)', () => {
  it('is a region the keyboard can reach, because on a desktop it scrolls on its own', async () => {
    server.use(
      mockRoute('me', () => USER),
      mockRoute('getCv', () => cvDetail({ document: editorDocument() })),
      mockRoute('getNotInCv', () => ({ items: [] })),
    );
    renderApp(`/cvs/${CV_ID}`);

    const preview = await screen.findByRole('region', { name: 'CV preview' });
    expect(preview.tabIndex).toBe(0);
  });

  it('does not let a click on a link navigate the preview away', async () => {
    server.use(
      mockRoute('me', () => USER),
      mockRoute('getCv', () => cvDetail({ document: editorDocument() })),
      mockRoute('getNotInCv', () => ({ items: [] })),
    );
    renderApp(`/cvs/${CV_ID}`);

    const frame = await screen.findByTitle('CV preview');
    await waitFor(() => {
      const links = (frame as HTMLIFrameElement).contentDocument?.body.querySelectorAll('a') ?? [];
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) expect(link.style.pointerEvents).toBe('none');
    });
  });
});
