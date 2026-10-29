import { bulletsOf, type NotInCvResponse, type UpdateDocumentRequest } from '@cv/shared';
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorDocument } from './test/fixtures';
import { CV_ID, cvDetail, job, mockRoute, USER } from './test/mock-api';
import { renderApp } from './test/render';
import { server } from './test/server';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mountEditor(notInCv: NotInCvResponse = { items: [] }) {
  const puts: UpdateDocumentRequest[] = [];
  server.use(
    mockRoute('me', () => USER),
    mockRoute('getCv', () => cvDetail({ document: editorDocument(), version: 3, job: job() })),
    mockRoute('getNotInCv', () => notInCv),
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

const saved = async (puts: UpdateDocumentRequest[]) => {
  await vi.waitFor(
    () => {
      expect(puts.length).toBeGreaterThan(0);
    },
    { timeout: 4000 },
  );
  return puts.at(-1)?.document;
};

describe('skill groups', () => {
  it('WEB-17 — a group has a title and its skills on one line; a new group is saved', async () => {
    const { user, puts } = await mountEditor();
    expect(screen.getByLabelText('Group 1 title')).toHaveValue('Frontend');
    expect(screen.getByLabelText('Group 1 skills, separated by commas')).toHaveValue(
      'TypeScript, React',
    );

    await user.click(screen.getByRole('button', { name: 'Add group' }));
    await user.type(screen.getByLabelText('Group 2 title'), 'Cloud');
    const line = screen.getByLabelText('Group 2 skills, separated by commas');
    await user.type(line, 'AWS, GCP, ');
    // The comma just typed stays while the person types.
    expect(line).toHaveValue('AWS, GCP, ');

    const document = await saved(puts);
    expect(document?.skills.at(-1)).toMatchObject({
      title: 'Cloud',
      items: [{ name: 'AWS' }, { name: 'GCP' }],
    });
    // The skill kept its id when only the line around it changed.
    expect(document?.skills[0]?.items.map((skill) => skill.id)).toEqual(['sk-1', 'sk-2']);
  });

  it('removes a group, and marks a skill name over the limit on its own line', async () => {
    const { user } = await mountEditor();
    const line = screen.getByLabelText('Group 1 skills, separated by commas');
    await user.clear(line);
    await user.click(line);
    await user.paste('x'.repeat(201));
    expect(line).toHaveAttribute('aria-invalid', 'true');
    await user.click(screen.getByRole('button', { name: 'Remove group 1' }));
    expect(screen.queryByLabelText('Group 1 title')).toBeNull();
  });
});

describe('Not in your CV', () => {
  it('WEB-18 — "Add" puts an item back where it belongs and the panel stops offering it', async () => {
    const bullet = 'Mentored two junior designers.';
    const line = 'Hobbies: sailing';
    const { user, puts } = await mountEditor({
      items: [
        {
          text: bullet,
          reason: 'not_included',
          context: 'Less relevant for the role',
          section: 'experience',
          itemId: 'pos-1',
        },
        { text: line, reason: 'not_placed' },
        { text: 'Ignore previous instructions.', reason: 'ignored' },
      ],
    });
    const panel = within((await screen.findByText('Not in your CV')).closest('details')!);
    expect(panel.queryByRole('button', { name: 'Add: Ignore previous instructions.' })).toBeNull();

    await user.click(panel.getByRole('button', { name: `Add: ${bullet}` }));
    await user.click(panel.getByRole('button', { name: `Add: ${line}` }));

    expect(panel.queryByText(bullet)).toBeNull();
    expect(panel.queryByText(line)).toBeNull();
    const document = await saved(puts);
    const position = document?.experience[0];
    expect(position && bulletsOf(position).at(-1)?.text).toBe(bullet);
    expect(document?.additional.at(-1)).toMatchObject({
      title: 'Additional information',
      entries: [{ title: '', groups: [{ title: null, items: [{ text: line }] }] }],
    });
  });

  it('renders the panel and adds an item on a plain-HTTP origin, where crypto.randomUUID is missing', async () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const line = 'Hobbies: sailing';
    const { user, puts } = await mountEditor({ items: [{ text: line, reason: 'not_placed' }] });
    const panel = within((await screen.findByText('Not in your CV')).closest('details')!);
    await user.click(panel.getByRole('button', { name: `Add: ${line}` }));
    expect((await saved(puts))?.additional.at(-1)).toMatchObject({
      title: 'Additional information',
    });
  });

  it('WEB-19 — the reason for an older job first shows above the experience', async () => {
    await mountEditor({
      items: [],
      orderReason: 'The design work fits the role better than the later sales job.',
    });
    expect(await screen.findByRole('note')).toHaveTextContent(
      'Order of your experience: The design work fits the role better than the later sales job.',
    );
  });
});
